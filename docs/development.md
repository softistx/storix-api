# Development

See [troubleshooting.md](troubleshooting.md) for the messages the server and its scripts print.

## Install

`@softistx/*` packages come from npm.softistx.com, mapped by the committed `.npmrc` and `bunfig.toml`,
which read `NPM_REGISTRY_TOKEN` (exported by `~/.zshenv`). `@alxia/*` and `@nxgt/*` come from npmjs.

```sh
bun install
```

## Run

`bun run dev` runs `docker compose up` for MongoDB (a one-node replica set, transactions need
one), Redis, Mailpit and SeaweedFS, waits until they are healthy, then starts the API in watch
mode. `GET /health` answers 200; `GET /ready` answers 503 while MongoDB does not.
The services keep running when the API stops: `bun run services:down` stops them.

| Service   | Host port               | Use                                                               |
| --------- | ----------------------- | ----------------------------------------------------------------- |
| MongoDB   | 27019                   | `mongodb://localhost:27019/?replicaSet=rs0&directConnection=true` |
| Redis     | 6381                    | rate limits, queues, tokens                                       |
| Mailpit   | 1027 (SMTP), 8027 (web) | every mail of the dev stack                                       |
| SeaweedFS | 8333                    | S3 API, `storix-dev` / `storix-dev-secret`, bucket `storix-files` |

Each port is overridable in `.env` (see `.env.example`).

## The green bar

`bun run verify` runs, in order: `generate`, `schema:print --check` (`schema.graphql` is
committed and must match), `check:ci` (Biome, `context:check`, `deps:check`), `bun check`, the
tests, the build. `bun test` needs no Docker: `test/setup.ts` starts an in-memory MongoDB
replica set.
- `context:check`: every error code declared with `defineCodes` has a row in `CONTEXT.md`.
- `deps:check`: no file outside `src/core/identity/**` and `src/config/auth.ts` imports a
  `@softistx/janus*` package (the identity seam, plan §3.11).
- `verify:pr` selects the specs that are, or import, a changed file (`src/scripts/affected-tests.ts`);
  a change to shared infrastructure runs them all.

## Migrations and indexes

- `bun run db:migrate` applies the pending core migrations (the `translations` rows for now). Flags: `--dry-run` lists them, `--status` lists every id with its state (applied, pending, missing), `--rollback-to <id>` undoes everything after `<id>` (the migration `<id>` itself stays applied).
- `bun run db:sync` creates the indexes and validators of the core collections and of the identity's own (janus's users, sessions, tokens, relations and API keys; `--dry-run` previews). Outside production the server syncs the identity's collections at boot, before the migrations; in production only with `MONGO_AUTO_SYNC`, otherwise `db:sync` is the deployment step.
- A new error code needs its `defineCodes` entry, a migration with both languages, and a CONTEXT.md row: `coverage.spec.ts` and `bun run context:check` fail otherwise.
- A migration that creates codes undoes them with `removeTexts`; one that rewords codes an earlier migration created undoes the rewording with `restoreTexts(previous)` (`@alxia/i18n`, over `translations.store.ts`).

## Boot and deploy

The boot rule, once: outside production the server applies the pending migrations itself. In production it refuses to start while a migration is pending (`MigrationsOutOfSyncError`), since the migration is a deployment step, not something every instance races to do. A migration recorded in the database but not in the build (a newer build already ran it) logs a warning, applies nothing (in dev too) and the server starts, so an old instance restarting during a rollout or a code rollback still comes up. Then the server loads the translations and refuses to start when a code has no text in the fallback language. Each message is in [troubleshooting.md](troubleshooting.md).

```sh
# Deploy: schema first, then data, then code
bun run db:sync                      # indexes and validators (core + identity, API keys included)
bun run db:migrate                   # pending migrations
# ...roll out the new version

# Rollback: code first, then data
# ...roll back to the previous version (it boots: it only warns about the newer migrations)
bun run db:migrate --status          # list the ids
bun run db:migrate --rollback-to <id>  # undo everything after <id>
```

## Accounts

Accounts live behind the `Identity` port (`src/core/identity`); janus is its adapter and is imported
nowhere else (`bun run deps:check`). `src/config/auth.ts` builds the port the server runs.

- `TOTP_KEYS` seals the accounts' authenticator secrets: `id:key`, each key 32 random bytes in base64 (`openssl rand -base64 32`), comma-separated, the first key seals and every key opens (a new key is put first when rotating). Required in production; a development key stands in elsewhere. A lost key makes every enrolled second factor unreadable.
- `AUDIT_IP_KEY` keys the hash of the client address kept in the audit log (see "Audit log"): 32 characters or more, required in production, a development default elsewhere.
- `MAIL_URL` (`smtp://` or `smtps://`) sends the mails; unset, they are printed to the console (tokens print as `<hidden>` outside `NODE_ENV=development`). `UI_ORIGIN` starts every link of a mail and `MAIL_FROM` is the sender. The UI pages the links open are `/auth/verify-email`, `/auth/reset-password` and `/account/security`, each reading `?token=`, and `/invitations/accept`, which reads the code from the fragment (`#<code>`).
- A sign-up is passwordless: the account is created with no credential and its owner chooses a password from the verification link (`completeSignUp`). A taken address answers the same way and creates nothing.
- A personal API key (`stx_...`) is read from `Authorization: Bearer` only, and only on `/graphql`, `/media`, `/health` and `/ready`; anywhere else it is refused 401 `auth.errors.api-key-not-accepted`, and so is a key-shaped bearer (`stx_...`) that did not authenticate. Every account operation but `viewer` refuses a key too (`requireSession`, `src/core/identity/identity.resolver.ts`). Creating, listing and revoking keys come with the slice that needs them; the key store is wired and synced.
- janus throttles the mails it sends (five per address and ten minutes) and the tries of a challenge; it answers `auth.errors.rate-limited`.
- A per-IP limit (`src/http/rate-limits.ts`, `@softistx/redis` `defineRateLimit`) guards `signUp`, `signIn` (and the two second-factor confirmations), `requestPasswordReset`, `createWorkspace` and the two open invitation operations `invitationPreview` and `acceptInvitation` (`RATE_LIMIT_INVITATION_CODE`, `30/900`); `issueInvitation` and `resendInvitation` are limited per inviter, not per address (`RATE_LIMIT_INVITATION_SEND`, `50/3600`): 429 `auth.errors.rate-limited`. `RATE_LIMIT_SIGN_UP` (`10/3600`), `RATE_LIMIT_SIGN_IN` (`30/900`), `RATE_LIMIT_PASSWORD_RESET` (`10/3600`) and `RATE_LIMIT_WORKSPACE_CREATE` (`10/3600`) are `<attempts>/<seconds>`. `REDIS_URL` is required in production; unset, nothing is limited. A Redis error lets the request through, logged. The limit specs start a real Redis (`redis-memory-server`): set `REDISMS_DOWNLOAD_DIR` to reuse a cached build.
- There is no resend operation: "sign up again" mails a fresh link to an unverified address. The caller's `name` is left out of that mail until the address is proved (it greets the address).
- `disableSecondFactor` takes a current app code or, when the phone is lost, a recovery code (spent through janus's sign-in recovery; the session it opens is ended at once).

## Workspaces, members and roles

A workspace is the tenant: a row in the core database (`workspaces`) and a database of its own
(`<MONGO_WORKSPACE_PREFIX><id>`). `src/config/tenancy.ts` builds the `@alxia/tenancy` store, `src/config/access.ts`
the permission catalogue (`@alxia/access`), and `src/http/context.ts` hands each resolver a `ctx.guard`.

- A request names its workspace in the **`x-storix-workspace`** header, by id or by slug. Without it a workspace operation is 400 `workspaces.errors.workspace-required`. An unknown workspace, a workspace the caller does not belong to and one that is not open yet are all 404 `workspaces.errors.not-found`: a caller learns nothing about a workspace they are not in.
- Roles are `OWNER`, `ADMIN`, `MEMBER`. Modules declare `permissions` and `defaultGrants`; OWNER holds every permission. `owners:manage` is the owners' alone: only an OWNER makes, demotes or removes an owner. A workspace always keeps an owner (409 `workspaces.errors.last-owner` on leaving, demoting or removing the last one, concurrent changes included).
- A resolver of a workspace opens with `requireWorkspacePermission(ctx, "<area>:<action>")` or `requireWorkspaceMember(ctx)` (`src/core/access`). Order of refusals: 401, 400, 404, 403. `changeMemberRole` and `removeMember` also need a fresh session (`assertFresh`: 403 `auth.errors.step-up-required`, then `requestStepUp` and `confirmStepUp`), checked after the permission. `leaveWorkspace` asks for no step-up (owner decision, 2026-11-14).
- A personal API key is refused on every workspace operation (401 `auth.errors.api-key-not-accepted`) until the `api-keys` slice binds keys to workspaces.
- `createWorkspace` writes the workspace (`provisioning`) and its creator as OWNER in one transaction, builds the workspace's database, then opens it (`active`); a failure takes the rows back out. A crash between the transaction and the opening leaves a `provisioning` workspace that keeps its slug: no sweeper exists yet (issue #70). Building a database needs the connection's user to be allowed to create databases and indexes (`dbAdmin` on `storix_ws_*`): in production the deploy sets it up.
- The context cannot name `typeof tenancy` (its type is built from the registered modules, whose resolvers are typed by the context): `ctx.tenancy` and `scope` are the plain ports of `src/core/access/ports.ts`, and a resolver casts `scope.core` / `scope.mongo` to its module's typed handle.

## Invitations

An admin invites an address into the request's workspace; the invitee accepts with the code of the mail and becomes a member. The fields (`invitations`, `issueInvitation`, `resendInvitation`, `revokeInvitation`, `invitationPreview`, `acceptInvitation`) and their store are janus's (`auth.invitations`, `@softistx/janus-graphql`'s `invitationResolvers`); `src/core/invitations` says who may invite and adds the accepted account to the workspace.

- The scope of an invitation is the workspace id, and it must be the workspace of the `x-storix-workspace` header: any other scope is 404 `invitations.errors.not-found`. Every owner-side field needs `members:manage` (`ADMIN` and `OWNER`); inviting as `OWNER` needs `owners:manage`. `issueInvitation` and `revokeInvitation` also need a fresh session (403 `auth.errors.step-up-required`), after the permission. A personal API key is refused (401 `auth.errors.api-key-not-accepted`). The role is a workspace role (`OWNER`, `ADMIN`, `MEMBER`).
- The code is 43 characters of which only the sha256 is stored. It lives 7 days (`INVITATION_LIFETIME`), serves once, and reaches the invitee's inbox only (`#<code>` in the link to `UI_ORIGIN/invitations/accept`: the fragment never reaches a server): the response of `issueInvitation` carries `code: null`. A workspace holds at most 200 pending invitations (409 `invitations.errors.limit`) and one per address: issuing again for the address retires the earlier one, as does `resendInvitation` (new code, old one dead). An unknown, spent, revoked or lapsed code is one 400 `invitations.errors.invalid`.
- Accepting makes the account when the address has none (a password is needed: 400 `invitations.errors.password-required`) and signs it in (`InvitationSignedIn.token`, the UI's server sets the cookie). An address that already has an account is not signed in (`InvitationSignIn`: the code proves the inbox, not who holds the account) but is a member at once. An address that is already a member cannot be invited (409 `invitations.errors.already-member`).
- `invitationPreview` and `acceptInvitation` are open to whoever holds a code: counted per client address (`RATE_LIMIT_INVITATION_CODE`). Sends are counted per inviter (`RATE_LIMIT_INVITATION_SEND`); a refused request sends no mail.
- The SDL is janus-graphql's own (`node_modules/@softistx/janus-graphql/graphql`, read by `codegen.ts`), with its `@authenticated`, `@fresh` and `@permission` declarations: they do nothing here, `authorize` (`src/core/invitations/invitations.hooks.ts`) is the guard.

## Teams

`src/modules/teams` keeps the workspace's teams in its own database (`teams`: `name`, `memberIds`). The fields: `teams`, `team(id)`, `createTeam`, `renameTeam`, `setTeamMembers`, `deleteTeam`.

- `teams:read` is held by every role; `teams:manage` (every mutation) by `OWNER` and `ADMIN`, granted by the module's `defaultGrants` like `members:manage`. No step-up. A personal API key is refused (401 `auth.errors.api-key-not-accepted`).
- A name is trimmed, 1 to 100 characters, and unique in the workspace ignoring case (a unique index with collation `en`, strength 2): 409 `teams.errors.name-taken`. A team may be renamed to its own name in another case.
- `memberIds` are `Member.id`s. `setTeamMembers` replaces the list, drops repeats, and refuses every id that is not a current member of the request's workspace (400 `teams.errors.member-unknown`, nothing changes).
- A team of another workspace is 404 `teams.errors.not-found`: the request's workspace database is the only one a resolver reaches.
- A member who is removed or leaves is taken out of every team: the kernel cannot import a business module, so `src/core/members` exposes `onMemberRemoved` and `teams` registers itself when its manifest loads; `removeMember` and `leaveWorkspace` call the listeners once the membership has ended. A listener that fails is logged and never undoes the removal; the `Team` view only ever lists current members, so a missed clean-up stays invisible.

## Folders

`src/modules/nodes` keeps the workspace's tree in its own database: one `nodes` collection for folders (files join it with the files module). The fields: `roots`, `folders(parentId)`, `nodePath(id)`, `createFolder`, `renameNode`, `moveNodes`.

- **A private root per member.** Each member owns one root folder, "My files" (`parentId` null, `ancestors` empty). Nothing in another member's tree is readable: an owner and an admin included, it is 404 `nodes.errors.not-found`, like an unknown or malformed id (sharing, a later slice, widens that one rule). `nodes:read` and `nodes:manage` are held by `ADMIN` and `MEMBER` (and `OWNER`, who holds all). A personal API key is refused.
- **Made at joining.** `src/core/members` exposes `onMemberJoined`; `nodes` registers itself when its manifest loads, and `memberJoined` runs the listeners once the membership is written (the workspace's creator, an accepted invitation). It is also made on the first `roots`, `createFolder` or `moveNodes`, for a member who joined before the module existed or whose set-up failed; two makers at once leave one (a unique index per owner).
- **Names** are trimmed, 1 to 255 characters, with no `/`, `\` or control character, and not `.` or `..` (400 `validation.errors.invalid-input`, field `name`). They are unique among the live siblings of a parent ignoring case (collation `en`, strength 2): 409 `nodes.errors.name-taken`.
- **Depth** is at most 16, a root being 1: 409 `nodes.errors.too-deep` for a create or a move that would pass it (a move counts the deepest node of the subtree).
- **`ancestors`** lists the ids from the root to the parent, so a subtree is one index read. A move rewrites the `ancestors` of the whole subtree in one transaction, up to 5,000 nodes (409 `nodes.errors.move-too-large`). A folder moved into itself or its own subtree is 409 `nodes.errors.cycle`. A root is never renamed nor moved (409 `nodes.errors.root-locked`). A parent that is not a folder is 400 `nodes.errors.not-a-folder`.
- **Concurrency.** `renameNode` carries the `version` read with the node and refuses a stale one (409 `nodes.errors.conflict`: a rename or a move came first). Every write that changes the shape of a tree (create, move) first raises the root's `treeRev` in its transaction, so two of them at once conflict and the later one runs again on the result of the earlier one: no cycle, no stale `ancestors`. `moveNodes` is all or nothing (1 to 100 ids; a node selected with its own parent moves with it, once; a node already in the folder is left as it is).

## Audit log

`src/core/audit` keeps an append-only log of the workspace's writes in the workspace's own database (`auditEvents`). The kernel's `audit.record(event)` port is called by a resolver after the write committed; a failure to record is logged (`console.error`) and never undoes the write. Modules reach it through `@/core/audit` and declare `dependsOn: ["audit"]`.

- **Events**: `workspace.create`; `member.role-change` (`from`, `to`), `member.remove`, `member.leave` (`accountId`, `role`); `invitation.issue`, `invitation.resend`, `invitation.revoke`, `invitation.accept` (`role`; the target's name is the invitee's email); `team.create`, `team.rename` (`from`, `to`), `team.set-members` (`count`, `added`, `removed`), `team.delete`; `node.folder-create` (`parentId`), `node.rename` (`from`, `to`), `node.move` (`from`, `to`). A role change to the same role and a refused write record nothing. There is no workspace-update mutation in this effort, so no event for one.
- **Shape**: `at`, `actor` (`type` MEMBER, API_KEY, TOKEN or LINK; `id`; `label`), `action`, `target` (`type`, `id`, `name`), `ipHash`, `meta` (strings, numbers and booleans). `meta` never holds a secret: an invitation code, a password or a token is not recorded, and a key whose name looks like one is dropped.
- **`ipHash`** is the HMAC-SHA256 (hex) of the client address under `AUDIT_IP_KEY`, never the address. The same address gives the same hash, so events can be correlated; rotating the key breaks the correlation with older events. `AUDIT_IP_KEY` is required in production (32 characters or more) and has a development default.
- **Retention**: a TTL index removes an event after 365 days. Indexes: `at`, `target.id` + `at`, `actor.id` + `at`.
- **Reading**: `auditEvents(filter, first, after)`, newest first, 1 to 100 per page (50 by default), with a `filter` on `actorId`, `action`, `targetId` and a `from` (included) / `to` (excluded) period. It needs `audit:read` (OWNER through "holds all", ADMIN through `defaultGrants`); a MEMBER gets 403 `auth.errors.forbidden` and a personal API key 401 `auth.errors.api-key-not-accepted`. A cursor belongs to the filter it came from: with another filter it is 400 `validation.errors.invalid-cursor` (field `after`). The page has no total count.

## The proxy secret

`@alxia/core` 0.23's `requireProxySecret({ paths, secret })` refuses a request to a path that
does not carry the BFF's secret. storix-api has no BFF-only path: `/graphql` and `/media` are
also reached by workspace API keys (consumer servers), and the account operations are GraphQL
fields of `/graphql`; a key is kept from every other path by the `auth.errors.api-key-not-accepted`
refusal (`src/http/key-paths.ts`), not by the secret; `/public/*` is reached by browsers of other origins. So `API_PROXY_SECRET`
only decides whether the forwarded client address is honoured (`src/http/client-ip.ts`), and
`requireProxySecret` stays unwired. A BFF-only path added later (for instance an internal
route) is the case to wire it for.
