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
| `bun run verify`       | the green bar: generate, schema check, Biome, context and dependency checks, `bun check`, tests, build |
| `bun run verify:pr`    | the same with only the specs a diff against `origin/develop` affects                                   |
| `bun run generate`     | scalars and validation SDL, then resolver types and Zod schemas into `src/generated/`                  |
| `bun run db:migrate`   | applies the pending core migrations (`--dry-run`, `--status`, `--rollback-to <id>`)                    |
| `bun run db:sync`      | creates the indexes and validators of the core and identity collections (`--dry-run` to preview)      |
| `bun run schema:print` | writes `schema.graphql`, the committed contract a client generates its types from                    |

## Layout

| Path                            | Holds                                                               |
| ------------------------------- | ------------------------------------------------------------------- |
| `src/core/`                     | the kernel: `workspaces`, `members`, `invitations`, `audit`, `access`, `identity`, `translations`, `system` |
| `src/modules/teams/`            | a workspace's teams                                                  |
| `src/modules/nodes/`            | the folder tree: each member's root, create, rename, move           |
| `src/modules/registry.ts`       | the one list of modules                                             |
| `src/i18n/`                     | the error inventory (`defineCodes`, `ErrorCode`), `fail`, the i18n instance, the coverage check |
| `src/config/`                   | `env.ts` (read once at import), the MongoDB handle                  |
| `src/http/`                     | the base (request id, client address), the schema, the Yoga plugins |
| `docker-compose.yml`, `docker/` | the development services                                            |
| `CONTEXT.md`                    | the domain glossary and the error-code table                        |

Some runtime dependencies are declared ahead of the slices that import them; `mongodb` and `nodemailer` are peers of `@softistx/mongo` and `@softistx/mail-smtp` (which asks for `nodemailer` `>=7 <11`, `mongodb` `>=7 <8`), hence listed here.

## Accounts

Every operation below is a field of `POST /graphql`. Every request carries an `x-storix-client` header (any non-empty value, the client's name); without it the refusal is 403 `auth.errors.client-header-required`. A session token goes in `Authorization: Bearer <token>`; every
operation except `viewer` refuses a personal API key (`stx_...`) with 401 `auth.errors.api-key-not-accepted`. The
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
request through (logged), janus's own per-account throttles still hold.

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

A personal API key is refused on workspace operations (401 `auth.errors.api-key-not-accepted`). The detail is in
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
