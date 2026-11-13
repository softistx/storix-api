# Development

## Install

`@softistx/*` packages come from GitHub Packages, mapped by the committed `.npmrc`, which reads
`GITHUB_TOKEN` (a token with `read:packages`). `@alxia/*` and `@nxgt/*` come from npmjs.

```sh
GITHUB_TOKEN=$(gh auth token) bun install
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

## The proxy secret

`@alxia/core` 0.23's `requireProxySecret({ paths, secret })` refuses a request to a path that
does not carry the BFF's secret. storix-api has no BFF-only path: `/graphql` and `/media` are
also reached by workspace API keys (consumer servers), and the account operations are GraphQL
fields of `/graphql`, kept from keys by the `auth.errors.api-key-not-accepted` refusal (E1),
not by the secret; `/public/*` is reached by browsers of other origins. So `API_PROXY_SECRET`
only decides whether the forwarded client address is honoured (`src/http/client-ip.ts`), and
`requireProxySecret` stays unwired. A BFF-only path added later (for instance an internal
route) is the case to wire it for.
