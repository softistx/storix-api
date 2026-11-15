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
- `MAIL_URL` (`smtp://` or `smtps://`) sends the mails; unset, they are printed to the console (tokens print as `<hidden>` outside `NODE_ENV=development`). `UI_ORIGIN` starts every link of a mail and `MAIL_FROM` is the sender. The UI pages the links open are `/auth/verify-email`, `/auth/reset-password` and `/account/security`, each reading `?token=`.
- A sign-up is passwordless: the account is created with no credential and its owner chooses a password from the verification link (`completeSignUp`). A taken address answers the same way and creates nothing.
- A personal API key (`stx_...`) is read from `Authorization: Bearer` only, and only on `/graphql`, `/media`, `/health` and `/ready`; anywhere else it is refused 401 `auth.errors.api-key-not-accepted`, and so is a key-shaped bearer (`stx_...`) that did not authenticate. Every account operation but `viewer` refuses a key too (`requireSession`, `src/core/identity/identity.resolver.ts`). Creating, listing and revoking keys come with the slice that needs them; the key store is wired and synced.
- janus throttles the mails it sends (five per address and ten minutes) and the tries of a challenge; it answers `auth.errors.rate-limited`.
- A per-IP limit (`src/http/rate-limits.ts`, `@softistx/redis` `defineRateLimit`) guards `signUp`, `signIn` (and the two second-factor confirmations), `requestPasswordReset` and `createWorkspace`: 429 `auth.errors.rate-limited`. `RATE_LIMIT_SIGN_UP` (`10/3600`), `RATE_LIMIT_SIGN_IN` (`30/900`), `RATE_LIMIT_PASSWORD_RESET` (`10/3600`) and `RATE_LIMIT_WORKSPACE_CREATE` (`10/3600`) are `<attempts>/<seconds>`. `REDIS_URL` is required in production; unset, nothing is limited. A Redis error lets the request through, logged. The limit specs start a real Redis (`redis-memory-server`): set `REDISMS_DOWNLOAD_DIR` to reuse a cached build.
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

## The proxy secret

`@alxia/core` 0.23's `requireProxySecret({ paths, secret })` refuses a request to a path that
does not carry the BFF's secret. storix-api has no BFF-only path: `/graphql` and `/media` are
also reached by workspace API keys (consumer servers), and the account operations are GraphQL
fields of `/graphql`; a key is kept from every other path by the `auth.errors.api-key-not-accepted`
refusal (`src/http/key-paths.ts`), not by the secret; `/public/*` is reached by browsers of other origins. So `API_PROXY_SECRET`
only decides whether the forwarded client address is honoured (`src/http/client-ip.ts`), and
`requireProxySecret` stays unwired. A BFF-only path added later (for instance an internal
route) is the case to wire it for.
