# Troubleshooting

Each heading is the exact message. The boot rule behind them is in [development.md](development.md#boot-and-deploy).

## `N migration(s) pending: run bun run db:migrate`

The server stops at startup with `MigrationsOutOfSyncError`.

**When:** in production (outside production the server migrates itself), when the build lists migrations the database has not applied, usually because the new version was rolled out before the data step.

**Why:** the new code reads texts and indexes those migrations write, and every instance racing to migrate at boot is unsafe, so production refuses.

**Fix:** run the data step, then start the server again.

```sh
bun run db:migrate --status   # the pending ids
bun run db:migrate
```

## `N migration(s) recorded but not in this build: <ids>`

A warning on the console. The server does start.

**When:** the database has migrations a newer build ran, and this build does not list them: an old instance restarting during a rollout, or a code rollback after `db:migrate`.

**Why:** the server must come up in both cases, so it only warns. The newer texts stay in the database, and this build serves the codes it knows.

**Fix:** none for a rollout in progress. After a code rollback, undo the newer migrations once the old build runs, or deploy the newer build again.

```sh
bun run db:migrate --status
bun run db:migrate --rollback-to <last id this build lists>
```

## `--rollback-to needs an id`

`bun run db:migrate --rollback-to` was given no id.

**Fix:** pass the id of the migration to keep; everything after it is undone. `--status` lists the ids.

```sh
bun run db:migrate --status
bun run db:migrate --rollback-to 2026-11-13-auth-validation-errors
```

## `translations: no fallback-language text for <code> (en), ...`

The server stops at startup while it loads the translations.

**When:** a declared error code has no row in the fallback language (English) in the `translations` collection: its migration was not applied, or a row was deleted by hand.

**Why:** English is the last step of every language's chain; without it a client could receive a code with no message.

**Fix:** apply the migration that writes the code's texts, or add the English text to that migration and run it.

```sh
bun run db:migrate
```

## `no translations in the fallback language "en"`

The server stops at startup while it loads the translations.

**When:** the `translations` collection holds no row at all in English: the migrations were never applied to this database (a new or emptied one), or the collection was dropped.

**Why:** English is the last step of every language's chain, so with no English rows no refusal can be worded.

**Fix:** apply the migrations.

```sh
bun run db:migrate
```

## `TOTP_KEYS: ...`

The server stops at startup while it reads the environment.

**When:** `TOTP_KEYS` is missing in production, an entry has no `id:` (`id:key`), two entries share an id, a key is not 32 random bytes in base64, or the development key is used in production.

**Fix:** generate a key and list it as `id:key`; the first entry seals, every entry opens.

```sh
echo "TOTP_KEYS=k1:$(openssl rand -base64 32)"
```

## `MAIL_URL`, `UI_ORIGIN` or `MAIL_FROM` is invalid

The server stops at startup while it reads the environment.

**When:** `MAIL_URL` is not `smtp://` or `smtps://`, `UI_ORIGIN` is not an origin (`https://app.example.com`, no path), or `MAIL_FROM` is not a plain e-mail address.

**Fix:** correct the variable. Unset `MAIL_URL` prints the mails to the console instead (tokens print as `<hidden>` outside `NODE_ENV=development`).

## Sign-up or sign-in fails with a missing index or validator

Identity operations fail on first use, or two accounts share an address.

**When:** the identity collections (users, sessions, tokens, relations, API keys) were never synced. Outside production the server syncs them at boot; in production only with `MONGO_AUTO_SYNC`.

**Fix:** run the schema step of the deploy.

```sh
bun run db:sync
```

## Second factors no longer open (a lost `TOTP_KEYS` key)

A user who enrolled an authenticator cannot confirm a code, or the server cannot read the secret.

**Why:** the secrets are sealed with a key of `TOTP_KEYS`; every key that ever sealed one must stay listed to open it. A key removed from the list makes its secrets unreadable.

**Fix:** restore the key. When it is truly lost, the affected accounts must have their second factor reset by an operator (clear it in the `users` collection) and enrol again.

## `auth.errors.rate-limited` (429) on sign-up, sign-in, reset, workspace creation or invitations

**When:** a client address went past `RATE_LIMIT_SIGN_UP`, `RATE_LIMIT_SIGN_IN` or `RATE_LIMIT_PASSWORD_RESET`, `RATE_LIMIT_WORKSPACE_CREATE`, `RATE_LIMIT_INVITATION_CODE` (a code previewed or accepted) or, per inviter, `RATE_LIMIT_INVITATION_SEND` (`<attempts>/<seconds>`), or janus's per-account throttle (five mails per address and ten minutes, the tries of a challenge) tripped. `extensions.retryAfter` says how long to wait.

**Why:** behind a proxy every visitor looks like one address unless the forwarded address is honoured (`API_PROXY_SECRET`, `src/http/client-ip.ts`).

**Fix:** wait, or raise the variable. The limit is off when `REDIS_URL` is unset.

## `invitations.errors.invalid` (400) on a link that looked fine

**When:** `invitationPreview` or `acceptInvitation` got a code that names no pending invitation.

**Why:** the code was already used, the invitation was revoked or sent again (a new code replaced it), or its 7 days passed. The reasons are never told apart, so a guesser learns nothing.

**Fix:** an admin sends the invitation again (`resendInvitation`: a new code, the old one dies) or issues a new one. A mail scanner that follows links does not spend a code: the link opens a page that posts it from a button.

## `invitations.errors.not-pending`, `limit`, `already-member` (409) and `password-required` (400)

**When:** `revokeInvitation` or `resendInvitation` on an invitation that is no longer pending (`not-pending`); `issueInvitation` with 200 pending invitations in the workspace (`limit`) or to an address that is already a member (`already-member`, field `email`); `acceptInvitation` for a new account without a `password` (`password-required`).

**Fix:** `not-pending`: list the invitations and act on a pending one, or issue a new one. `limit`: revoke stale invitations. `already-member`: change the member's role instead. `password-required`: `invitationPreview` says `needsPassword`; send the password with the code.

## `invitations.errors.not-found` (404)

**When:** an invitation operation named a scope that is not the workspace of the `x-storix-workspace` header, or an invitation id outside it.

**Fix:** send the header of the workspace that owns the invitation, and pass that workspace's id as `scope`.

## `auth.errors.client-header-required` (403)

**When:** a `/graphql` request came without an `x-storix-client` header, or with an empty one. The refusal comes before the query is parsed, so it hits every operation, signed in or not.

**Why:** a browser sends a custom header only after a CORS preflight, which a page of another origin does not pass; the check keeps cross-site requests from reaching a resolver, cookie or not.

**Fix:** send the header with any non-empty value, the client's name.

```sh
curl -s localhost:3000/graphql -H 'content-type: application/json' -H 'x-storix-client: my-app' \
  -d '{"query":"{ viewer { id } }"}'
```

## `members.errors.not-found` (404)

**When:** `changeMemberRole` or `removeMember` named a `memberId` that is not a current member of the request's workspace: malformed, unknown, a member of another workspace, or one who already left.

**Why:** the answer is the same for all four so that an id from another workspace tells nothing.

**Fix:** send the `x-storix-workspace` header of the workspace that owns the member, and an id from its `members` list (`nodes { id }`, not the `accountId`).

## `workspaces.errors.workspace-required` (400) on a workspace operation

**When:** a members or workspace query came without the `x-storix-workspace` header.

**Fix:** send the header with the workspace id or slug. Refusals come in this order: 401 (not signed in), 400 (no header), 404 (`workspaces.errors.not-found`), 403 (missing permission).

## `workspaces.errors.not-found` (404) for a workspace that exists

**When:** the workspace is unknown, still `provisioning`, or the caller is not a member of it. All three answer alike so that a stranger learns nothing.

**Fix:** check the id or slug and the membership. A workspace stuck in `provisioning` after a crash is not swept yet; ask an operator to remove or finish it.

## `workspaces.errors.slug-taken` (409) on `createWorkspace`

**When:** another workspace, even one still provisioning, holds the slug.

**Fix:** choose another slug.

## `workspaces.errors.last-owner` (409) on a role change, removal or leave

**When:** the operation would leave the workspace with no OWNER.

**Fix:** promote another member to OWNER first, then demote, remove or leave.

## `auth.errors.step-up-required` (403) on a role change or a member removal

`changeMemberRole` and `removeMember` answer 403 with this code.

**When:** the acting account's session is older than 10 minutes. `leaveWorkspace` never asks for it.

**Why:** both mutations are sensitive, so they need a recent password or second-factor check, after the permission check (a caller who may not manage members gets `auth.errors.forbidden` instead).

**Fix:** step up, then retry the same mutation.

```graphql
mutation { requestStepUp { method challenge } }
mutation { confirmStepUp(challenge: "...", code: "123456") }
```

## `teams.errors.name-taken` (409) and `member-unknown` (400)

**When:** `createTeam` or `renameTeam` with a name another team of the workspace already has (`name-taken`, field `name`); `setTeamMembers` with an id that is not a current member of the request's workspace (`member-unknown`, field `memberIds`).

**Why:** names are compared ignoring case (`Design` and `design` are one). Member ids are `Member.id`s (not account ids), and a member who left, a member of another workspace or a malformed id is unknown.

**Fix:** pick another name, or list `teams` to find the existing one. For `member-unknown`, take the ids from `members` of the same workspace (the `x-storix-workspace` header) and send the list again; the team was not changed.

## `teams.errors.not-found` (404)

**When:** a team operation named an id that is malformed, was deleted, or belongs to a team of another workspace.

**Fix:** send the `x-storix-workspace` header of the workspace that owns the team, and an id from its `teams`.

## `storage.errors.*` on `/media`

**When:** `PUT /media/<kind>` or `GET /media/<kind>/<key>` is refused. The body is `/graphql`'s shape, `{ "errors": [{ "message", "extensions": { "code", "params" } }] }`, with the refusal's status.

**Why and fix, by code:**
- `not-found` (404; a `files` object is also 404 until `addFile` records its key, and for any member but its owner): the key is not in the workspace named by `x-storix-workspace`. A key of another workspace, an unknown one and a caller who may not read are the same answer. Send the header of the workspace that stored the file.
- `too-large` (413, `params.limitMib`): the `Content-Length` is over the kind's limit (`files` 95 MiB, `avatars` 10 MiB); nothing was read or stored.
- `unsupported-type` (415): `avatars` takes JPEG, PNG and WebP only, and the first bytes must match the declared `Content-Type`. `files` takes any type.
- `empty` (400): a zero-length body. `interrupted` (400): the body ended short of, or ran past, its `Content-Length`; send it again.
- `rate-limited` (429): 30 uploads a minute per account and workspace (burst 60). Wait `params.seconds` (also the `Retry-After` header). Uploads fail closed: with Redis down the answer is the same 429 with `params.seconds` 5.
- `unavailable` (503): `S3_BUCKET`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` are not all set, or the store did not answer. Locally run `bun run services:up` and copy the `S3_*` lines of `.env.example`.
- `unprocessable` (422): an avatar could not be decoded or is smaller than 64 px on its short side; nothing stays stored. Send a valid JPEG, PNG or WebP.
- `stalled` (408): the client sent nothing for 60 seconds during the upload; send it again and keep the connection moving.
- `range-not-satisfiable` (416): the `Range` starts past the end; `Content-Range: bytes */<size>` carries the size.
- A request with no session is 401 `auth.errors.unauthenticated`, with no workspace header 400 `workspaces.errors.workspace-required`, and a personal API key 401 `auth.errors.api-key-not-accepted` (keys are bound to workspaces in a later slice).

## `AUDIT_IP_KEY` must be at least 32 characters (boot error in production)

**When:** the API refuses to start in production with an environment error naming `AUDIT_IP_KEY`.

**Why:** the audit log stores a keyed hash of each client address, and the key is mandatory in production. In development a built-in default is used.

**Fix:** set `AUDIT_IP_KEY` to a random secret of 32 characters or more (for example `openssl rand -hex 32`). Changing it later only breaks the correlation of old and new `ipHash` values.

## `validation.errors.invalid-cursor` (400) on `auditEvents` and `nodes`

**When:** `auditEvents` or `nodes` is called with an `after` that is malformed, or that came from a page read with another `filter` (for `nodes`, another folder, filter or sort too).

**Fix:** start again without `after`, then send each page's `endCursor` with the same `filter`.

## `nodes.errors.not-found` (404) for a folder that exists

**When:** `createFolder`, `renameNode`, `moveNodes`, `folders` or `nodePath` named an id that is not in the caller's own tree: malformed, unknown, of another workspace, or in another member's tree (an owner's or an admin's included).

**Why:** the four answer alike so that an id tells nothing, and a member's files are private until they are shared.

**Fix:** send the `x-storix-workspace` header of the workspace and an id from the caller's own `roots` or `folders`.

## `nodes.errors.conflict` (409) on `renameNode`

**When:** the `version` sent is not the folder's current one.

**Why:** the folder was renamed or moved since the client read it; the rename is refused instead of overwriting.

**Fix:** read the node again (`nodePath`, `folders`), then rename with its new `version`.

## `nodes.errors.name-taken`, `too-deep`, `cycle`, `move-too-large`, `root-locked` (409)

**When:** a sibling holds the name in any case (`name-taken`, field `name`); the folder would pass 16 levels (`too-deep`); a folder is moved into itself or its own subtree (`cycle`); the moved folder holds more than 5,000 nodes (`move-too-large`); a root is renamed or moved (`root-locked`).

**Fix:** pick another name or destination. `too-deep`: flatten the destination. `move-too-large`: move the folder's sub-folders in turn (a batched move is planned).

## `files.errors.key-unknown` (400) on `addFile`

**When:** `addFile` named a `key` (field `key`) that is not a recordable upload.

**Why:** the object is looked up under this workspace's `files` prefix, so a key of another workspace or of another kind (an avatar), a malformed key and a key never uploaded all fail alike; so does an empty object and a key a file already holds (a key is recorded once).

**Fix:** upload again with `PUT /media/files` in the same workspace (`x-storix-workspace`) and record the key it answers, once. For a second file, upload again.

## `nodes.errors.not-a-folder` (400)

**When:** the `parentId` of `createFolder` or `moveNodes` names a node that is not a folder (field `parentId`).

**Fix:** send the id of a folder of the caller's own tree.
