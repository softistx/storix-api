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
| `bun run schema:print` | writes `schema.graphql`, the committed contract storix-ui generates its client from                    |

## Layout

| Path                            | Holds                                                               |
| ------------------------------- | ------------------------------------------------------------------- |
| `src/core/`                     | the kernel: modules every other module may use                      |
| `src/modules/registry.ts`       | the one list of modules                                             |
| `src/config/`                   | `env.ts` (read once at import), the MongoDB handle                  |
| `src/http/`                     | the base (request id, client address), the schema, the Yoga plugins |
| `docker-compose.yml`, `docker/` | the development services                                            |
| `CONTEXT.md`                    | the domain glossary and the error-code table                        |

The runtime dependencies are declared up front for the v1 slices, so some are not imported yet; `mongodb` and `nodemailer` are peers of `@softistx/mongo` and `@softistx/mail-smtp` (which asks for `nodemailer` `>=7 <11`, `mongodb` `>=7 <8`), hence listed here.
