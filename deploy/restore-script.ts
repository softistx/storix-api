/**
 * The shell programs restore.ts and restore-drill.ts run in the backup container
 * (`sh -c`), kept in a module of their own so a spec can run them with stubs of
 * mc, mongosh, mongod, mongodump and mongorestore first in PATH. They read their
 * settings from the environment (RESTORE_URI, CORE, ORG_PREFIX, DUMP, ...); BACKUP_LIB,
 * BACKUPS_DIR and TMPBASE default to the container's paths and exist for the specs.
 * No import: restore.ts must start on a host without node_modules.
 */

/** The restore: replay the archive into a scratch mongod, dump the wanted databases (pass 1), then restore them live (pass 2). */
export const restoreScript = `
set -eu
. "\${BACKUP_LIB:-/usr/local/bin/backup-lib}"
mc_aliases
dest="offsite/$BACKUP_S3_BUCKET/\${FROM_PREFIX:-$BACKUP_S3_PREFIX}"
base="\${TMPBASE:-/tmp}"
tmp="$(mktemp -d "$base/restore.XXXXXX")"
conf="$(mktemp "$base/restore.XXXXXX")"
cleanup() { scratch_stop; rm -rf "$conf" "$tmp"; }
trap cleanup EXIT
trap 'exit 143' TERM INT HUP
file="$DUMP"
# The dump read here: from the volume, or fetched into the temp folder (the
# volume's retention and the healthcheck never see it).
if [ -n "$FROM_OFFSITE" ]; then
  [ "$file" = latest ] && file="$(mc ls "$dest/mongo/" | awk '{print $NF}' | grep '^mongo-[0-9TZ]*\\.tar$' | sort | tail -1)"
  [ -n "$file" ] || { echo "no dump found offsite" >&2; exit 1; }
  mc cp --quiet "$dest/mongo/$file" "$tmp/$file"
  tarfile="$tmp/$file"
else
  if [ "$file" = latest ]; then
    file="$(ls "\${BACKUPS_DIR:-/backups}" | grep '^mongo-[0-9TZ]*\\.tar$' | sort | tail -1)"
  fi
  [ -n "$file" ] || { echo "no dump found" >&2; exit 1; }
  tarfile="\${BACKUPS_DIR:-/backups}/$file"
fi
echo "restore: $file into $CORE and $ORG_PREFIX*\${DATABASE:+ (only $DATABASE)}"
# The URI carries the root password: a 0600 config file, not an argument.
printf "uri: '%s'\\n" "$RESTORE_URI" > "$conf"
mkdir "$tmp/db" "$tmp/out"
tar -xf "$tarfile" -C "$tmp/db"
# Whether a database is one this restore brings back.
wanted() {
  case "$1" in
    "$CORE"|"$ORG_PREFIX"*) ;;
    *) return 1 ;;
  esac
  [ -z "$DATABASE" ] || [ "$1" = "$DATABASE" ]
}
if [ -e "$tmp/db/instance.archive.gz" ]; then
  # A full-instance dump with its oplog: replayed whole into a scratch mongod
  # (backup-lib). PASS 1 dumps every wanted database from it; nothing live is
  # touched until all of them are dumped.
  echo "restore: replaying the oplog into a scratch mongod"
  scratch_start "$tmp/db/instance.archive.gz"
  dbs="$(mongosh --nodb --quiet --eval 'connect(process.env.SCRATCH_URI).adminCommand({ listDatabases: 1, nameOnly: true }).databases.map((d) => d.name).join("\\n")')"
  for db in $dbs; do
    wanted "$db" || continue
    echo "restore: reading $db"
    mongodump --uri="$SCRATCH_URI" --db="$db" --gzip --archive="$tmp/out/$db.archive.gz" --quiet
  done
  out="$tmp/out"
else
  # A tar from before the oplog dump: one archive per database, no oplog.
  out="$tmp/db"
fi
# PASS 2: the live restore. A stop in this loop leaves the databases from
# different moments until the restore is run again.
restored=0
for archive in "$out"/*.archive.gz; do
  [ -e "$archive" ] || break
  db="$(basename "$archive" .archive.gz)"
  wanted "$db" || { echo "restore: skipping $db"; continue; }
  echo "restore: $db"
  mongorestore --config="$conf" --gzip --archive="$archive" --nsInclude="$db.*" --drop --quiet
  restored=$((restored + 1))
done
[ "$restored" -gt 0 ] || { echo "restore: the dump holds no database to restore" >&2; exit 1; }
if [ -n "$MEDIA" ]; then
  echo "restore: media from offsite"
  mc mirror --quiet --overwrite "$dest/media" "local/$S3_BUCKET"
fi
echo "restore: done"
`;

/** The drill: the same replay, restored under scratch names, then counts. */
export const drillScript = `
set -eu
. "\${BACKUP_LIB:-/usr/local/bin/backup-lib}"
file="$DUMP"
if [ "$file" = latest ]; then
  file="$(ls "\${BACKUPS_DIR:-/backups}" | grep '^mongo-[0-9TZ]*\\.tar$' | sort | tail -1)"
fi
[ -n "$file" ] || { echo "no dump found" >&2; exit 1; }
base="\${TMPBASE:-/tmp}"
conf="$(mktemp "$base/drill.XXXXXX")"
tmp="$(mktemp -d "$base/drill.XXXXXX")"
drop() {
  mongosh --nodb --quiet --eval 'const c = connect(process.env.RESTORE_URI); for (const { name } of c.adminCommand({ listDatabases: 1, nameOnly: true }).databases) if (name.startsWith(process.env.SCRATCH)) c.getSiblingDB(name).dropDatabase()' >/dev/null || echo "drill: could not drop $SCRATCH*" >&2
  scratch_stop
  rm -rf "$conf" "$tmp"
}
trap drop EXIT
trap 'exit 143' TERM INT HUP
printf "uri: '%s'\\n" "$RESTORE_URI" > "$conf"
tar -xf "\${BACKUPS_DIR:-/backups}/$file" -C "$tmp"
# The scratch name of a live one: <SCRATCH>core, or <SCRATCH>ws_<id>.
scratch_of() {
  case "$1" in
    "$CORE") echo "\${SCRATCH}core" ;;
    "$ORG_PREFIX"*) echo "\${SCRATCH}ws_\${1#"$ORG_PREFIX"}" ;;
    *) return 1 ;;
  esac
}
if [ -e "$tmp/instance.archive.gz" ]; then
  # A full-instance dump with its oplog: replayed whole into a scratch mongod
  # (backup-lib), then each storix database is restored from there under its
  # scratch name. The instance itself is only written to under SCRATCH*.
  scratch_start "$tmp/instance.archive.gz"
  dbs="$(mongosh --nodb --quiet --eval 'connect(process.env.SCRATCH_URI).adminCommand({ listDatabases: 1, nameOnly: true }).databases.map((d) => d.name).join("\\n")')"
  for db in $dbs; do
    to="$(scratch_of "$db")" || continue
    mongodump --uri="$SCRATCH_URI" --db="$db" --archive="$tmp/one.archive" --quiet
    mongorestore --config="$conf" --archive="$tmp/one.archive" --nsInclude="$db.*" --nsFrom="$db.*" --nsTo="$to.*" --quiet
    rm -f "$tmp/one.archive"
  done
else
  # A tar from before the oplog dump: one archive per database, no oplog.
  for archive in "$tmp"/*.archive.gz; do
    [ -e "$archive" ] || break
    db="$(basename "$archive" .archive.gz)"
    to="$(scratch_of "$db")" || continue
    mongorestore --config="$conf" --gzip --archive="$archive" --nsInclude="$db.*" --nsFrom="$db.*" --nsTo="$to.*" --quiet
  done
fi
echo "DRILL_DUMP $file"
printf 'DRILL_COUNTS '
mongosh --nodb --quiet --eval '
  const c = connect(process.env.RESTORE_URI);
  const out = { core: {}, workspaces: {} };
  const count = (db) => { const o = {}; for (const i of db.getCollectionInfos({ type: "collection" })) o[i.name] = db.getCollection(i.name).countDocuments(); return o };
  for (const { name } of c.adminCommand({ listDatabases: 1, nameOnly: true }).databases) {
    if (!name.startsWith(process.env.SCRATCH)) continue;
    const rest = name.slice(process.env.SCRATCH.length);
    if (rest === "core") out.core = count(c.getSiblingDB(name));
    else if (rest.startsWith("ws_")) out.workspaces[rest.slice(3)] = count(c.getSiblingDB(name));
  }
  print(JSON.stringify(out))'
`;
