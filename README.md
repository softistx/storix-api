# storix-api

storix is the softistx file manager: a workspace's files in folders, shared with people, teams and links, searchable, versioned, and embeddable in other softistx products through a widget. This repository is the GraphQL API (Bun, alxia, Yoga) and its queue worker.

The v1 plan is split into efforts E0 to E8, each a tracking issue with its slices as issues; `docs/roadmap.md` links them.

## Run it

```sh
bun install   # @softistx/* comes from npm.softistx.com (NPM_REGISTRY_TOKEN)
cp .env.example .env
bun run dev                                  # starts the Docker services, then the API on :3000
curl localhost:3000/health
```

`bun run services:down` stops the services. `docs/development.md` has the details.

## Scripts

| Script                 | Does                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `bun run dev`          | the Docker services (MongoDB replica set, Redis, Mailpit, SeaweedFS), then the API in watch mode       |
| `bun run worker`       | the queue worker in watch mode (renditions: thumbnails and previews); needs `REDIS_URL`, `S3_*` and `MONGO_URI`; `bun run dev` does not start it |
| `bun run verify`       | the green bar: generate, schema check, Biome, context and dependency checks, `bun check`, tests, build |
| `bun run verify:pr`    | the same with only the specs a diff against `origin/develop` affects                                   |
| `bun run generate`     | scalars and validation SDL, then resolver types and Zod schemas into `src/generated/`                  |
| `bun run db:migrate`   | applies the pending core migrations (`--dry-run`, `--status`, `--rollback-to <id>`)                    |
| `bun run db:sync`      | creates the indexes and validators of the core and identity collections (`--dry-run` to preview)      |
| `bun run schema:print` | writes `schema.graphql`, the committed contract a client generates its types from                    |

## Layout

| Path                            | Holds                                                               |
| ------------------------------- | ------------------------------------------------------------------- |
| `src/core/`                     | the kernel: `workspaces`, `members`, `invitations`, `audit`, `access`, `identity`, `translations`, `storage`, `system` |
| `src/core/storage/`             | `/media`: `@alxia/media` over one private S3 bucket (`files`, `avatars` kinds) |
| `src/modules/teams/`            | a workspace's teams                                                  |
| `src/modules/nodes/`            | the folder tree: each member's root, create, rename, move, `node` and `nodes` (filter, sort, cursor) |
| `src/modules/files/`            | files: `addFile`, `copyNodes`, `updateFile`, `setStarred`, `openFile` (`blobs`, `stars`, `recents`) |
| `src/worker.ts`, `src/workers/`, `src/queues/` | the worker entry (`dist/worker.js`), its handlers and the queue definitions |
| `src/modules/registry.ts`       | the one list of modules                                             |
| `src/i18n/`                     | the error inventory (`defineCodes`, `ErrorCode`), `fail`, the i18n instance, the coverage check |
| `src/config/`                   | `env.ts` (read once at import), the MongoDB handle                  |
| `src/http/`                     | the base (request id, client address), the schema, the Yoga plugins |
| `docker-compose.yml`, `docker/` | the development services                                            |
| `CONTEXT.md`                    | the domain glossary and the error-code table                        |

Some runtime dependencies are declared ahead of the slices that import them; `mongodb` and `nodemailer` are peers of `@softistx/mongo` and `@softistx/mail-smtp` (which asks for `nodemailer` `>=7 <11`, `mongodb` `>=7 <8`), hence listed here.

## Accounts

Every operation below is a field of `POST /graphql`. Every request carries an `x-storix-client` header (any non-empty value, the client's name); without it the refusal is 403 `auth.errors.client-header-required`. A session token goes in `Authorization: Bearer <token>`; every
operation except `viewer`, and `/media`, refuse a personal API key (`stx_...`) with 401 `auth.errors.api-key-not-accepted`. The
sign-up, sign-in and password-reset operations are also limited per client address (see [Rate limits](#rate-limits)).

```sh
curl -s localhost:3000/graphql -H 'content-type: application/json' -H 'x-storix-client: my-app' \
  -d '{"query":"mutation { signUp(input: { email: \"ada@example.com\", name: \"Ada\", locale: EN }) { status } }"}'
```

```graphql
# 1. Sign up: passwordless. Answers VERIFICATION_SENT whether or not the address is taken.
mutation { signUp(input: { email: "ada@example.com", name: "Ada", locale: EN }) { status } }

# 2. verifyEmail: the link of the mail carries ?token=; the visitor chooses a password. Proves the address and signs in.
mutation { completeSignUp(token: "<token>", password: "a long passphrase") { status token expiresAt viewer { id email } } }
```

There is no separate resend operation: signing up again with the same address mails a fresh link while the address is
unverified, and a notice to the owner once it is verified.

```graphql
# 3. Sign in: SIGNED_IN, or SECOND_FACTOR with a challenge to answer
mutation { signIn(input: { email: "ada@example.com", password: "a long passphrase" }) { status token challenge expiresAt } }
mutation { confirmSecondFactor(challenge: "<challenge>", code: "123456") { status token } }
mutation { recoverSecondFactor(challenge: "<challenge>", recoveryCode: "<code>") { status token } }

# 4. Sign out, forgotten password
mutation { signOut }
mutation { requestPasswordReset(email: "ada@example.com") }
mutation { resetPassword(token: "<token>", password: "a new passphrase") }

# 5. Step-up: sensitive operations need a session confirmed in the last 10 minutes (403 auth.errors.step-up-required)
mutation { requestStepUp { method challenge expiresAt } }
mutation { confirmStepUp(challenge: "<challenge>", code: "123456") }

# 6. Second factor (each needs a fresh session)
mutation { enrolSecondFactor { secret uri } }
mutation { activateSecondFactor(code: "123456") { recoveryCodes } }
mutation { regenerateRecoveryCodes(code: "123456") { recoveryCodes } }
mutation { disableSecondFactor(code: "123456") }   # or a recovery code, when the phone is lost
query { secondFactorStatus { enabled recoveryCodesLeft } }

# 7. Who is calling: the only operation a personal API key may use
query { viewer { id email emailVerified hasSecondFactor sessionConfirmedUntil apiKeyId } }
```

`viewer` is null when anonymous; for an API key `apiKeyId` is set and the session fields are null. After the second
factor is lost, sign in with a recovery code, `disableSecondFactor` with another recovery code, then enrol again.

### Rate limits

`signUp`, `signIn` (with `confirmSecondFactor` and `recoverSecondFactor`), `requestPasswordReset`, `createWorkspace` (`RATE_LIMIT_WORKSPACE_CREATE`, each one provisions a database) and the open invitation operations `invitationPreview` and `acceptInvitation` (`RATE_LIMIT_INVITATION_CODE`) are limited per
client address; `issueInvitation` and `resendInvitation` (`RATE_LIMIT_INVITATION_SEND`, each one sends a mail) are limited per inviter with `@softistx/redis`; past the limit the refusal is 429 `auth.errors.rate-limited` and `extensions.retryAfter`
says when to retry. The limits are `<attempts>/<seconds>` in the environment:

| Variable                    | Default   |
| --------------------------- | --------- |
| `RATE_LIMIT_SIGN_UP`        | `10/3600` |
| `RATE_LIMIT_SIGN_IN`        | `30/900`  |
| `RATE_LIMIT_PASSWORD_RESET` | `10/3600` |
| `RATE_LIMIT_WORKSPACE_CREATE` | `10/3600` |
| `RATE_LIMIT_INVITATION_SEND` | `50/3600` |
| `RATE_LIMIT_INVITATION_CODE` | `30/900`  |

They need `REDIS_URL` (required in production); without it nothing is limited. A Redis that does not answer lets the
request through (logged), janus's own per-account throttles still hold. The `/media` upload limit ([Files](#files)) is the exception: it fails closed.

## Workspaces

A workspace is the tenant: its files and teams live in a database of its own. Create one, then name it in the
`x-storix-workspace` header (its id or its slug) on every workspace operation. Both headers are needed on a
workspace call: `x-storix-client` (403 `auth.errors.client-header-required` without it) and `x-storix-workspace`
(400 `workspaces.errors.workspace-required` without it). A workspace you are not a member of, one that does not
exist and one not yet open are all 404 `workspaces.errors.not-found`.

```sh
TOKEN=<session token>
# Create a workspace (no workspace header yet): you become its OWNER
curl -s localhost:3000/graphql -H 'content-type: application/json' -H 'x-storix-client: my-app' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"mutation { createWorkspace(input: { name: \"Acme\", slug: \"acme\" }) { id slug myRole } }"}'

# A workspace-scoped call: the members of "acme"
curl -s localhost:3000/graphql -H 'content-type: application/json' -H 'x-storix-client: my-app' \
  -H "Authorization: Bearer $TOKEN" -H 'x-storix-workspace: acme' \
  -d '{"query":"{ members { totalCount nodes { id email role } } }"}'
```

A personal API key is refused on workspace operations and on `/media` (401 `auth.errors.api-key-not-accepted`). The detail is in
[docs/development.md](docs/development.md):

- members, roles and permissions: [Workspaces, members and roles](docs/development.md#workspaces-members-and-roles)
- inviting people: [Invitations](docs/development.md#invitations)
- groups of members: [Teams](docs/development.md#teams)
- folders: [Folders](docs/development.md#folders)
- the record of writes: [Audit log](docs/development.md#audit-log)

Settings that belong here: `MONGO_WORKSPACE_PREFIX` (default `storix_ws_`) prefixes each workspace's database;
`AUDIT_IP_KEY` (32 characters or more, required in production) keys the hash of client addresses in the audit log;
`TOTP_KEYS` (`id:key`, 32 random bytes in base64) seals the accounts' second-factor secrets, and the server refuses to start in
production when it is unset (a development key stands in elsewhere). See `.env.example`.

## Files

Files go through `/media`, plain HTTP beside `/graphql`, over one private S3 bucket. Send a session token and
`x-storix-workspace` (`/media` does not ask for `x-storix-client`). `PUT /media/<kind>` stores the raw body (send
`Content-Length`; `curl --data-binary` does) and answers its `key`; `GET /media/<kind>/<key>` streams it back.

```sh
TOKEN=<session token>
# Upload: the key is yours to keep
curl -s -X PUT localhost:3000/media/files \
  -H "Authorization: Bearer $TOKEN" -H 'x-storix-workspace: acme' \
  -H 'Content-Type: text/plain' --data-binary @notes.txt
# {"key":"<key>","contentType":"text/plain","size":20}

# Download it (Range, ETag and If-None-Match are honoured: 206, 304, 416)
curl -s localhost:3000/media/files/<key> \
  -H "Authorization: Bearer $TOKEN" -H 'x-storix-workspace: acme'
```

| Kind      | Accepts                  | Limit   | Stored as                                  |
| --------- | ------------------------ | ------- | ------------------------------------------ |
| `files`   | any type                 | 95 MiB  | as sent; a type outside the inline-safe list is served as a download; JPEG, PNG, WebP and PDF also get `thumb` (320 px) and `preview` (1600 px) WebP renditions from the worker |
| `avatars` | JPEG, PNG and WebP       | 10 MiB  | only its 64 and 256 px squares (EXIF dropped) |

- **Storage settings**: `S3_BUCKET`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` (and `S3_ENDPOINT`, `S3_REGION`), set together;
  `bun run services:up` starts SeaweedFS locally. Without the three, every `/media` route answers 503
  `storage.errors.unavailable`. See `.env.example`.
- **Upload limit**: 30 a minute, burst 60, per account and workspace, with `@softistx/redis`. Past it the refusal is 429
  `storage.errors.rate-limited` with a `Retry-After` header. It fails closed: when Redis does not answer, uploads are
  refused too, with the same 429 (retry after 5 seconds). Without `REDIS_URL` nothing is limited.
- **Keys**: an object belongs to the workspace named by `x-storix-workspace`; a key of another workspace is 404
  `storage.errors.not-found`. A personal API key is refused with 401 `auth.errors.api-key-not-accepted`.

### Record an upload and list a folder

An upload is not a file until it is recorded: `addFile` takes the `key` that `PUT /media/files` answered, a name and a
folder of your tree. The type and the size come from the storage, never from the input. `onConflict` is `REFUSE` (the
default, `nodes.errors.name-taken`) or `KEEP_BOTH` (`report (1).pdf`). A key of another workspace or kind, a key
already recorded, a malformed one or one never uploaded is `files.errors.key-unknown`.

```graphql
mutation { addFile(input: { key: "<key>", name: "notes.txt", parentId: "<folder id>", onConflict: KEEP_BOTH }) { id name size family } }
query { nodes(parentId: "<folder id>", filter: { families: [IMAGE], name: "png" }, sort: { by: SIZE, direction: DESC }, first: 50) {
  nodes { id type name ... on File { size mimeType } } pageInfo { endCursor hasNextPage } } }
```

`nodes` lists folders first, then the files sorted by `NAME`, `DATE`, `SIZE` or `KIND` (either direction); `after` takes the
last page's `endCursor` with the same folder, filter and sort. `node(id)` answers one folder or file. Once recorded, a
`files` object is readable at `/media/files/<key>` by its owner only; an unrecorded one is 404.

### Storage quota

Each workspace has a quota (`quotaBytes`, 10 GiB by default) and counts what it stores in `usage`: `bytes` (each stored
object once, so a copy that shares a blob adds nothing), `files`, `versionBytes` and `trashBytes` (kept at 0 until E3).
`PUT /media/files` is refused with 413 `quotas.errors.exceeded` before its body is read when the declared length does
not fit (a chunked body is checked at its worst case, 95 MiB), and `addFile` refuses atomically, leaving no object, node
or blob. The `storage` query (`workspace:read`) answers `quotaBytes`, `usedBytes`, `currentBytes`, `versionBytes`,
`trashBytes` and `files`.

```sh
bun run workspace:quota acme 20GiB     # set a quota (bytes, 20GiB, or "default")
bun run quota:reconcile                # recount every workspace and fix any drift
bun run storage:sweep                  # remove released blobs and unrecorded objects older than 75 minutes
```

### Orphan sweep

Details: [docs/development.md](docs/development.md#orphan-sweep-storagesweep), failures: [docs/troubleshooting.md](docs/troubleshooting.md). Run one sweep at a time (for example `flock -n /tmp/storix-sweep.lock bun run storage:sweep` hourly from cron).

Storage that nothing references is removed by `bun run storage:sweep` (the `sweep` job; the worker does not run it yet: schedule it hourly from the host). Per active workspace it removes the blobs whose `refs` is 0 with their object and sizes, and the objects of an upload that `addFile` never recorded once they are 75 minutes old. A recorded object is never removed, and usage is not touched (it counts only blobs with `refs` above 0, as `quota:reconcile` recounts). It needs the bucket (`S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`) and exits 1 when a workspace failed or an object could not be removed (the next run retries).

### Rename, move, copy, tags and metadata

`renameNode` and `moveNodes` work on files and folders alike (a name clash is `nodes.errors.name-taken`, in any case).
`copyNodes(ids, parentId)` copies files and folders: a copy shares its blob, so the bucket gets no new object and
`blobs.refs` goes up; a copied folder takes what is under it (up to 5,000 nodes, `files.errors.copy-too-large`), and a
taken name becomes `report (1).pdf`. `updateFile(id, input)` replaces a file's `tags` (trimmed, lower case, unique, at most
20 of 50 characters) and `meta` (a JSON object of at most 16 KiB); a field left out stays, and `version` makes the write
conditional (`nodes.errors.conflict`). A folder is `files.errors.not-a-file`. Every bulk takes 1 to 100 ids and is all or
nothing: one refused node leaves the tree and the counts as they were.

```graphql
mutation { copyNodes(ids: ["<file id>", "<folder id>"], parentId: "<folder id>") { id name } }
mutation { updateFile(id: "<file id>", input: { tags: ["invoice", "2026"], meta: { client: "acme" } }) { tags meta version } }
```

### Favourites and recent files

`setStarred(id, starred)` stars or unstars any node of your tree (a repeat changes nothing) and answers it; `starred(first,
after)` lists your favourites, the latest star first. `recentFiles(first, after)` lists the files you uploaded or opened,
the latest first, one entry per file, 200 kept per member. `openFile(id)` is the "open": it notes the file as recent and
answers it. The three need `nodes:read` and see only your own tree; a trashed node leaves both lists and returns with its
restore. Both lists are paged by cursor (`pageInfo.endCursor`); a cursor of the other list is
`validation.errors.invalid-cursor`.

```graphql
mutation { setStarred(id: "<node id>", starred: true) { id name } }
query { starred(first: 20) { nodes { id name } pageInfo { endCursor hasNextPage } } }
mutation { openFile(id: "<file id>") { id name } }
query { recentFiles(first: 20) { nodes { id name } pageInfo { endCursor } } }
```

The detail is in [Files storage](docs/development.md#files-storage-media); every `storage.errors.*` refusal is in
[docs/troubleshooting.md](docs/troubleshooting.md).

## Errors

Every refusal carries a stable code `<module>.errors.<slug>` (`defineCodes` in `src/i18n/`), raised with `fail(code, { params })`. Messages are ICU, in English and French, stored as `translations` rows (one per code and language) by migrations. `src/i18n/coverage.spec.ts` fails when a code has no message in both languages. When the server applies migrations, and what a pending or unknown one does, is in [docs/development.md](docs/development.md#boot-and-deploy); the messages the server prints when it refuses to start are in [docs/troubleshooting.md](docs/troubleshooting.md).

### `errorCatalogue`

The public `Query.errorCatalogue(language)` serves every code's message in one language, for a client that words refusals itself. `language` defaults to the request's language (`Accept-Language`, then `?lang=`, then the `language` cookie, falling back to English); a code with no text in the language comes in English.

```graphql
query {
  errorCatalogue(language: fr) {
    language
    version
    messages {
      code
      message
    }
  }
}
```

```json
{
  "data": {
    "errorCatalogue": {
      "language": "fr",
      "version": "9f2c4a1e07b3d5c89f2c4a1e07b3d5c8",
      "messages": [
        { "code": "auth.errors.forbidden", "message": "Vous n’avez pas le droit de faire cela." },
        {
          "code": "auth.errors.rate-limited",
          "message": "Trop de tentatives. Réessayez dans {minutes, plural, one {# minute} other {# minutes}}."
        }
      ]
    }
  }
}
```

`message` is the uninterpolated ICU text; the client fills it with the refusal's `extensions.params`. `version` changes whenever a text of the language, or of English which fills it, changes (a deploy that adds or rewords one) and is the same after a restart. A client keeps the catalogue per language and asks for `version` alone (it reads no message) to know whether its copy is current, then re-reads `messages` only when it differs.

### Invalid input

An input refused as a whole is one error, `validation.errors.invalid-input` (HTTP 400), listing every refused field in `extensions.fields`. `path` is relative to the input, `code` is an error code, `params` holds the values its message interpolates (when it has any):

```json
{
  "errors": [
    {
      "message": "Some fields are not valid.",
      "path": ["createFolder"],
      "extensions": {
        "code": "validation.errors.invalid-input",
        "fields": [
          {
            "path": "name",
            "code": "validation.errors.too-long",
            "message": "This value is too long.",
            "params": { "max": 100 }
          },
          {
            "path": "color",
            "code": "validation.errors.invalid",
            "message": "This value is not valid."
          }
        ]
      }
    }
  ]
}
```

The refusals of a schema `@constraint` arrive in this same shape: the plugin in `src/http/api-errors.ts` converts them with `invalidInputOf` of `@nxgt/graphql-validation`, which maps each argument to its code and params (`minLength` is `too-short` with `params.min`, `maxLength` `too-long` with `params.max`, `min`/`max` `out-of-range`, and so on); the `@nxgt/graphql-validation` guide `docs/guide/invalid-input.md` has the full table.

### Thumbnails and previews (the worker)

`addFile` of a JPEG, PNG, WebP or PDF records the file as `PROCESSING` and enqueues a `renditions` job (`@softistx/redis`
queue, one job per file). The worker (`bun run worker`, `dist/worker.js` in production, a second process beside the API)
renders `thumb` (320 px) and `preview` (1600 px) WebP images with `@softistx/image` (page 1 for a PDF), stores them next to
the original and sets the file `READY`; they are served at `GET /media/files/<key>/thumb` and `/preview` (404 before
then). A picture that cannot be decoded ends `FAILED` after at most 4 attempts (at once for a corrupt file): only the
previews failed, the original stays downloadable. Other types stay `READY` with no previews, and so does every file when
`REDIS_URL` is unset (no worker, no previews).
