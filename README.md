# storix-api

storix is the softistx file manager: a workspace's files in folders, shared with people, teams and links, searchable, versioned, and embeddable in other softistx products through a widget. This repository is the GraphQL API (Bun, alxia, Yoga) and its queue worker.

The v1 plan is split into efforts E0 to E8, each a tracking issue with its slices as issues; `docs/roadmap.md` links them.

## Run it

```sh
GITHUB_TOKEN=$(gh auth token) bun install   # @softistx/* comes from GitHub Packages
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
| `bun run db:sync`      | creates the core collections' indexes and validators (`--dry-run` to preview)                          |
| `bun run schema:print` | writes `schema.graphql`, the committed contract a client generates its types from                    |

## Layout

| Path                            | Holds                                                               |
| ------------------------------- | ------------------------------------------------------------------- |
| `src/core/`                     | the kernel: modules every other module may use                      |
| `src/modules/registry.ts`       | the one list of modules                                             |
| `src/i18n/`                     | the error inventory (`defineCodes`, `ErrorCode`), `fail`, the i18n instance, the coverage check |
| `src/config/`                   | `env.ts` (read once at import), the MongoDB handle                  |
| `src/http/`                     | the base (request id, client address), the schema, the Yoga plugins |
| `docker-compose.yml`, `docker/` | the development services                                            |
| `CONTEXT.md`                    | the domain glossary and the error-code table                        |

The runtime dependencies are declared up front for the v1 slices, so some are not imported yet; `mongodb` and `nodemailer` are peers of `@softistx/mongo` and `@softistx/mail-smtp` (which asks for `nodemailer` `>=7 <11`, `mongodb` `>=7 <8`), hence listed here.

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

The refusals of a schema `@constraint` arrive in this same shape (the plugin in `src/http/api-errors.ts` reshapes them): the argument that refused picks the code (`minLength` is `too-short`, `maxLength` `too-long`, `min`/`max` `out-of-range`, `minItems` `too-few`, `maxItems` `too-many`, `format`/`pattern` `invalid-format`) and its limit is passed as `params.min` or `params.max`.
