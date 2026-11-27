# Deployment

The staging stack of storix-api, after pulsarix-api's `deploy/`. Everything lives in `deploy/` plus the `Dockerfile` at the root. Images are built on the host from the checkouts (no registry). `bun deploy/deploy.ts` is the one entry point; it never touches DNS.

## What runs

| Service                | Image                         | Role                                                                                                                                                      |
| ---------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mongo`                | `mongo:8.3`, by digest         | one-node replica set, auth on (keyfile from `MONGO_KEYFILE`)                                                                                              |
| `mongo-init`           | `mongo:8.3`, by digest         | one-shot: the app user, and the backup user when `MONGO_BACKUP_PASSWORD` is set (re-applied on every `up`)                                                |
| `redis`                | `redis:8.12`, pinned by digest | password, append-only. **Required**: rate limits, the renditions and mails queues, tokens                                                                 |
| `seaweedfs`, `s3-init` | SeaweedFS and `mc`, by digest | the S3 store of the files: master, volume server and S3 gateway in one process; `s3-init` creates the private bucket                                      |
| `api`                  | root `Dockerfile`             | the GraphQL API and the `/media` routes, port 3000, on the stack network and on `proxy`                                                                   |
| `worker`               | the API's image               | `dist/worker.js`: the renditions (thumbnails, previews) and the notification mails                                                                        |
| `jobs`                 | the API's image               | `deploy/jobs/jobs-loop`: storage sweep and retention hourly, quota reconcile nightly (none of them is scheduled by the worker yet)                        |
| `migrate`              | the API's image               | profile `ops`, one-shot run by `deploy.ts` before the api and the worker roll: `db:sync`, then `db:migrate`                                               |
| `backup`               | `deploy/backup/Dockerfile`    | profile `backup`, started with `--backup`: nightly `mongodump --oplog`, offsite copy, files mirror                                                        |
| `ui`                   | `../../storix-ui`             | profile `ui`, started with `--ui`; serves the widget's `dist` (see "The widget bundle")                                                                   |

No service publishes a port. Two networks: `internal`, private to the stack, holds every service; the external `proxy` network (nxgt-docker creates it) holds only `api` and `ui` as well, so Traefik reaches them by container name. `mongo`, `redis`, `seaweedfs`, the worker, the jobs and `backup` are on `internal` only. In development (`docker-compose.yml`) the published ports are bound to `127.0.0.1`.

Every container is capped (`deploy.resources.limits`: mongo and api 1 cpu / 1G, ui, seaweedfs, worker, jobs, migrate and backup 0.5 / 512M, redis 0.25 / 256M, one-shots 0.25 / 256M). Healthchecks run every 30 s or more (a bash TCP probe for mongo, `redis-cli ping`, a bash HTTP probe for the api, `wget` for seaweedfs and the ui, the loop's heartbeat for the jobs), never `mongosh` or `bun -e`. The worker has none: it serves nothing, and `restart: unless-stopped` brings it back. Images are pinned: mongo, Redis, SeaweedFS and the bucket client by digest, like `docker-compose.yml`.

## Routing and the client address

One public hostname, `UI_HOSTNAME` (`storix.softistx.com`). Traffic comes visitor, Cloudflare (tunnel), cloudflared, Traefik, app. The proxied `*.softistx.com` wildcard already covers the name: **never add a DNS record**. The API's router takes `Host(UI_HOSTNAME) && PathPrefix(/public/)` (priority 100: the public share links); the UI's router takes the rest. `/graphql` and `/media` have no router: the UI's server calls them by container name.

`TRUSTED_PROXIES=172.16.0.0/12` (the docker range) makes the API read the client address from `X-Forwarded-For` past Traefik only. It is required in production (the API refuses to start without it). A range or addresses only: a hop count stops the API at startup. Never the `cloudflare` keyword, `X-Real-Ip` or `CF-Connecting-IP`.

`API_PROXY_SECRET` (required, `openssl rand -hex 32`, at least 32 characters) is set on both `ui` and `api` from the same variable. The UI sends it as `x-storix-proxy-secret`; for `/graphql` and the media routes the API honours the forwarded client address only on a request that carries it. `/public/` is exempt (browsers reach it through Traefik, which cannot add the secret) and keeps `TRUSTED_PROXIES` alone.

## The API image

Bun 1.4.5 (the version CI uses), `oven/bun:1.4.5-slim`, linux x64 and arm64. The image holds `dist/` only: `bun run build` bundles `dist/server.js`, `dist/worker.js` and the operational scripts (`dist/scripts/db-sync.js`, `db-migrate.js`, `storage-sweep.js`, `retention.js`, `quota-reconcile.js`), so the stack runs them with `bun --no-install dist/scripts/<name>.js`, with no TypeScript and no `node_modules`. The api, worker, jobs and migrate services all use this one image.

## Migrations

`db:sync` then `db:migrate` are the deployment step (see [development.md](development.md#boot-and-deploy)): in production the server refuses to start while a migration is pending. `deploy.ts` runs the `migrate` one-shot after the build and before `up`, against the running data services, with the new image. A failure stops the deploy with the old containers still up. `db:migrate` also migrates every workspace database, so a workspace that predates a migration is brought up to date by the deploy. The API runs with `MONGO_AUTO_SYNC=true`, so a new workspace database gets its validators and indexes on creation: the app user holds `readWriteAnyDatabase` and `dbAdminAnyDatabase` (the backup user holds `backup` only).

## Scheduled scripts

The worker runs the renditions and mails queues; nothing in-process schedules the three maintenance scripts, so the `jobs` service does (`deploy/jobs/jobs-loop`, mounted read only into the API's image):

- `storage-sweep`, every `JOBS_SWEEP_EVERY` seconds (3600): removes the blobs nothing references and the objects of an unrecorded upload;
- `retention`, every `JOBS_RETENTION_EVERY` (3600): purges the trash and the file versions past their limits;
- `quota-reconcile`, every `JOBS_RECONCILE_EVERY` (86400): recounts each workspace's usage.

One job at a time, and each new `jobs` container runs all three once at start (the quota reconcile is idempotent). Keep one `jobs` container per stack. A job that fails is logged and tried again at its next due time; the others still run. The sweep also holds its own per-workspace lock. The loop stamps `/tmp/jobs-alive` every tick and the healthcheck turns unhealthy after ten minutes without one. When the worker takes these schedules over, the `jobs` service is removed.

## The widget bundle

storix-widget builds `dist/` (`loader.js`, a hashed bundle, `manifest.json`); storix-ui serves them. The compose file sets `WIDGET_DIST_DIR=/widget` on `ui` and bind-mounts the built `dist` there, read only, from `WIDGET_DIST` (default `../../storix-widget/dist`, relative to `deploy/`). Build the widget on the host before `up --ui` (`bun run build` in `storix-widget`); a missing folder fails `up` (the mount never creates it empty). storix-ui must read `WIDGET_DIST_DIR` for this to serve anything (it has no such route yet).

## First deploy

```sh
cp deploy/.env.example deploy/.env && chmod 600 deploy/.env   # fill every CHANGE_ME
export NPM_SOFTISTX_READ_TOKEN=...                            # or the token file deploy.ts reads
bun deploy/deploy.ts --dry-run          # the plan, and what the env file still lacks
flock /tmp/deploy.lock bun deploy/deploy.ts
```

One deploy at a time on the host: `flock /tmp/deploy.lock` makes a second one wait. `--dry-run` pulls, builds and starts nothing and opens no connection; it exits 1 when the env file has problems, so it is also the preflight. Flags: `--env`, `--prefix` (a second stack), `--no-pull`, `--ui`, `--backup`, `--timeout`. A rerun with nothing changed recreates nothing.

The steps: check the env file (mode 600, complete) and the mail key file (mode 600), check the external `proxy` and `bumail-internal` networks, `git pull --ff-only`, `build`, `migrate`, `up -d --wait`, `ps`. Once the stack is healthy, `deploy.ts` runs `docker image prune -f`, removes this app's previous image tags (never another product's, never one in use) and runs `docker builder prune -f --filter until=24h`. It never runs `system prune -a` and never touches a volume.

Check: `docker compose -f deploy/docker-compose.yaml --env-file deploy/.env ps` shows every service healthy; `GET /ready` answers 200 inside the API container. There is no bootstrap script: a person signs up, then creates a workspace (`createWorkspace`).

## Mail

Mail leaves through bumail's Mail API (`@softistx/mail-bumail`), from the `api` and the `worker` (the worker sends the queued notification mails). Both join bumail's external network `bumail-internal` and reach `http://bumail-app:8090/graphql` (`BUMAIL_URL`); the endpoint is private, never published. `MAIL_FROM` (`no-reply@softistx.com`) must be on a domain verified with DKIM in the bumail Compte that issued the key.

The service key (`bumail_...`, scope `mail:send`, restricted to the sender's domain, lifetime "Never") is one line in `deploy/secrets/mail_api_key` (git-ignored). Compose mounts it read only at `/run/secrets/mail_api_key` and the API reads it from `BUMAIL_API_KEY_FILE`; it is never an environment value or on a command line. The image runs as uid 1000 (`bun`), so the file is owned by 1000 with mode 600. One-time, on the host (writing from a prompt, then renaming over the file, so the key never shows in `ps` or the shell history):

```sh
mkdir -p deploy/secrets && chmod 700 deploy/secrets
(umask 077; read -rs -p 'Service key: ' k && printf '%s' "$k" > deploy/secrets/mail_api_key.new && mv -f deploy/secrets/mail_api_key.new deploy/secrets/mail_api_key; unset k)
docker run --rm -v "$PWD/deploy/secrets:/s" alpine chown 1000:1000 /s/mail_api_key   # the host user can no longer read it; that is expected
```

`deploy.ts` (and `--dry-run`) checks that the file exists with mode 600 (or 400), never its content, and that `bumail-internal` exists. The API refuses to start in production without a key that starts with `bumail_`; the refusal quotes no value. A key revoked or expired is the console's to say: sends fail, so rotate it (new key written by rename as above, redeploy, then revoke the old one).

A refused mail (`MailRefused`: unverified domain, suppressed address, ...) is final: the worker logs its code and drops the job, while a failure (`MailFailure`: outage, rate limit, quota) is retried by the queue. Every mail carries its notification id as `idempotencyKey`, so a retry never sends it twice.

**Rollback to SMTP** (kept one release): set `MAIL_TRANSPORT=smtp` and `MAIL_URL` in `deploy/.env`, redeploy; the key file stays mounted but is no longer read. Mail sent over SMTP is not in bumail's send log. The backup alert (`BACKUP_ALERT_TO`) mails over SMTP only and so keeps needing `MAIL_URL`.

## Backups

The offsite backup is **opt-in**: the `backup` service is in the compose profile `backup`, so a plain deploy neither builds nor starts it and `BACKUP_S3_*` and `MONGO_BACKUP_PASSWORD` are not required (the deploy prints "backup off"). `bun deploy/deploy.ts --backup` requires the four `BACKUP_S3_*` settings and `MONGO_BACKUP_PASSWORD` (checked before anything is built). Until it is on there is no offsite copy and `restore.ts` and `restore-drill.ts` (which run inside the `backup` container) are unavailable.

When enabled, the service dumps the whole Mongo instance with its oplog (one consistent moment) every night at `BACKUP_HOUR` (UTC) to the `backup-data` volume, copies the dump and a mirror of the files bucket offsite, keeps `BACKUP_RETENTION_DAYS` days locally, and mails `BACKUP_ALERT_TO` when a run fails or none succeeded for 26 h. Its healthcheck turns unhealthy at 26 h. The offsite key writes and reads only: it cannot delete or create a bucket. The 14-day offsite retention is an expiry rule set once on the bucket.

### Offsite bucket, one-time setup

Create a private bucket at the provider, a key limited to it (read and write objects, list), and an expiry rule of 14 days. Put the endpoint, bucket and key in `deploy/.env` (`BACKUP_S3_*`), then deploy with `--backup`.

## Restore and drill

```sh
bun deploy/restore-drill.ts                      # proves the latest dump restores, into scratch databases
bun deploy/restore.ts --yes --confirm default    # DROPS and restores the collections the dump holds
```

The drill restores the latest dump into `drill_<timestamp>_*` databases, compares their collections with the ones the code defines (`src/modules/registry.ts`, plus janus's), prints PASS or FAIL and drops the scratch databases. It never touches live data. Run it after the first deploy and then monthly. `restore.ts` needs `--yes` and `--confirm <prefix|default>` naming the stack; stop `api`, `worker` and `jobs` first when writes may land meanwhile. Options: `--file`, `--from-prefix` (another stack's offsite folder), `--database`, `--media` (mirror the files bucket back). The Mongo users are not restored: `mongo-init` recreates them on `up`.

## Rollback

`git checkout <good commit>` in the API checkout, then `bun deploy/deploy.ts --no-pull`. A newer build's migrations stay applied: the old server only warns about them and starts; undo them with `bun run db:migrate --rollback-to <id>` when needed (see [development.md](development.md#boot-and-deploy)). A data rollback is a restore.
