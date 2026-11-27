#!/usr/bin/env bun
/**
 * Restores the databases (the core one and every workspace's) from a backup
 * taken by the `backup` service, into the running stack. It DROPS the
 * collections it restores (the collections the dump holds, not the database), so it needs --yes and --confirm naming the stack
 * (the STACK_PREFIX, or `default` when empty). It does not stop api: stop it
 * first if writes may land meanwhile. The restore runs inside the backup
 * container (which has mongorestore and mc) with the Mongo root credential read
 * from the env file, never stored in the stack: the backup service itself only
 * holds the backup user's credential (the `backup` role).
 *
 *   bun deploy/restore.ts --yes --confirm <prefix|default> [--env deploy/.env] [--prefix demo]
 *                         [--file mongo-<ts>.tar | latest] [--offsite]
 *                         [--media] [--from-prefix <offsite prefix>]
 *                         [--database <db>]
 *
 *   --file     a dump in the backup volume (default: the newest)
 *   --offsite  fetch the dump from the offsite bucket first (a lost host), into
 *              a temp folder of the container, not the backup volume
 *   --media    also mirror the media bucket back from offsite
 *   --from-prefix  the offsite prefix to read, as written in the bucket
 *              (`storix` for an unprefixed stack), to restore another stack's
 *              dump into this one. Implies --offsite; the stack's BACKUP_S3_*
 *              must reach the same bucket. Default: this stack's own
 *              BACKUP_S3_PREFIX
 *   --database restore only this database (the core one, or
 *              <MONGO_WORKSPACE_PREFIX><id>); default: all of them
 *   --yes      required: the restore drops what it replaces
 *
 * A dump is one full-instance archive taken with `--oplog` (instance.archive.gz;
 * mongorestore cannot filter an oplog replay, which would also replace the Mongo
 * users, so the archive is replayed into a throwaway mongod of the container and
 * the databases are restored from there, backup-lib), or, for a tar made before
 * that, one archive per database without an oplog (restored one by one).
 * Either way only the core database and the workspace databases are restored
 * and the Mongo users are never touched.
 *
 * The restore is in two passes: every wanted database is first dumped from the
 * scratch mongod, and only when all succeeded is each one restored live
 * (--drop of the collections the dump holds). A restore stopped during the second
 * pass leaves the databases from different moments: run it again. A collection or
 * an workspace database created after the dump stays as it is. The Mongo users
 * are never restored; `up` re-creates them (mongo-init).
 */

import { fail, loadStack, mongoRootUri } from "./lib";
import { restoreOptions } from "./restore-args";
import { restoreScript } from "./restore-script";

const args = Bun.argv.slice(2);
const stack = await loadStack(args);
const root =
  stack.values["MONGO_ROOT_PASSWORD"] ??
  fail("MONGO_ROOT_PASSWORD is missing from the env file");
const options = restoreOptions(args, {
  stackPrefix: stack.prefix,
  values: stack.values,
});
if (options instanceof Error) fail(options.message);
const { core, orgPrefix, file, fromPrefix, database } = options;
const project = `${stack.namePrefix}storix`;
console.log(
  `restore target: stack ${options.target}, project ${project}, container ${project}-backup, databases ${core} and ${orgPrefix}*`,
);
const rootUri = mongoRootUri(stack.namePrefix, root);

// The program is restore-script.ts: it runs in the backup container (BACKUP_S3_*
// and S3_* are its own env).
const script = restoreScript;

await stack.composeWith(
  { RESTORE_URI: rootUri },
  "exec",
  "-T",
  "-e",
  "RESTORE_URI",
  "-e",
  `CORE=${core}`,
  "-e",
  `ORG_PREFIX=${orgPrefix}`,
  "-e",
  `DUMP=${file}`,
  "-e",
  `FROM_OFFSITE=${options.fromOffsite ? "1" : ""}`,
  "-e",
  `FROM_PREFIX=${fromPrefix}`,
  "-e",
  `MEDIA=${options.media ? "1" : ""}`,
  "-e",
  `DATABASE=${database}`,
  "backup",
  "sh",
  "-c",
  script,
);
