# Domain glossary

storix is the softistx file manager: a workspace's files in folders, shared with people, teams
and links, searchable, versioned, and embeddable in other softistx products through a widget.
The code, the GraphQL schema and the collections speak English, the default language of the
product (French is offered). Terms join this table slice by slice; the full model is
`docs/plan.md` §3.3.

| Term        | Meaning                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Module`    | A unit of the API declared by one `defineModule` manifest and listed in `src/modules/registry.ts`: its schema, resolvers, collections, permissions, codes.           |
| `Registry`  | The ONE list of modules (`src/modules/registry.ts`). Adding a module is one line there.                                                                              |
| `Kernel`    | `src/core/`: what every module may use. It depends on no business module. Business modules live in `src/modules/`.                                                   |
| `Workspace` | The tenant. Registered in the core database, with its own database `storix_ws_<id>` (`MONGO_WORKSPACE_PREFIX`). Built by E1.                                         |
| `Principal` | Who a request is from, as the `Identity` port (`src/core/identity`) gives it. The rest of the API stores an `accountId` as an opaque string and never imports janus. |

## Error codes

A refusal carries a code `<module>.errors.<slug>`, declared per module with `defineCodes` and
gathered in `ErrorCode` (`src/i18n/codes.ts`). Its message is data: one row per code and language
in the `translations` collection, written by a data migration, served by `Query.errorCatalogue`.
`bun run context:check` fails when a declared code has no row here, and `src/i18n/coverage.spec.ts`
when a code lacks a message in English or French.

| Code | Meaning |
| ---- | ------- |
| `auth.errors.unauthenticated` | No valid session or API key (401). |
| `auth.errors.forbidden` | Signed in, but not allowed to do this (403). |
| `auth.errors.client-header-required` | A `/graphql` request lacks the `x-storix-client` header (cross-site request protection). |
| `auth.errors.step-up-required` | The operation needs a recent re-authentication. |
| `auth.errors.second-factor-required` | The sign-in needs the account's second factor. |
| `auth.errors.rate-limited` | Too many attempts; `params.minutes` says when to retry. |
| `auth.errors.api-key-not-accepted` | An API key reached a path it may not (401). |
| `validation.errors.invalid-input` | An input was refused as a whole; `extensions.fields` lists each field (400). |
| `validation.errors.invalid` | A field's value is not valid. |
| `validation.errors.out-of-range` | A number is outside its bounds. |
| `validation.errors.invalid-cursor` | A page cursor is malformed or stale. |
| `validation.errors.invalid-filter` | A list filter is not valid. |
| `validation.errors.too-short` / `too-long` | A string is shorter or longer than its limit. |
| `validation.errors.too-few` / `too-many` | A list has fewer or more items than its limit. |
| `validation.errors.invalid-format` | A string does not match its format or pattern. |
