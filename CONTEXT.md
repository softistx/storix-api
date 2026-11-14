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
| `Identity` | The port (`src/core/identity`) behind which accounts live: sign-up, sign-in, reset, the second factor, step-up. janus is its adapter and is imported nowhere else (`bun run deps:check`). |
| `Viewer` | The `Principal` of the request as the GraphQL type `Viewer` (null when anonymous). A personal API key is a viewer with `apiKeyId` and no session; keys are accepted on `/graphql`, `/media`, `/health` and `/ready` only. |
| `Step-up` | A fresh proof of identity (an authenticator code, else a code mailed to the account) that makes a session "fresh" for 10 minutes, for sensitive operations. An API key is never fresh. |

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
| `auth.errors.client-header-required` | A `/graphql` request lacks the `x-storix-client` header (403, cross-site request protection). |
| `auth.errors.step-up-required` | The operation needs a recent re-authentication. |
| `auth.errors.second-factor-required` | The sign-in needs the account's second factor. |
| `auth.errors.rate-limited` | Too many attempts; `params.minutes` says when to retry. |
| `auth.errors.api-key-not-accepted` | An API key reached a path or an account operation it may not (401). |
| `identity.errors.invalid-credentials` | A sign-in failed: a wrong password, an unknown address or a deactivated account, which are never told apart (401). |
| `identity.errors.email-unverified` | The operation needs a verified e-mail address (403). |
| `identity.errors.token-invalid` | A link or challenge token is unknown, spent, expired or stale (400). |
| `identity.errors.second-factor-invalid` | A second-factor or step-up code is wrong or already used; `extensions.attemptsLeft` says how many tries remain (400). |
| `identity.errors.second-factor-state` | The second factor is not in the state the operation needs: not enrolled, or already active (409). |
| `identity.errors.unavailable` | The identity store cannot answer; try again (503). |
| `validation.errors.invalid-input` | An input was refused as a whole; `extensions.fields` lists each field (400). |
| `validation.errors.invalid` | A field's value is not valid. |
| `validation.errors.out-of-range` | A number is outside its bounds. |
| `validation.errors.invalid-cursor` | A page cursor is malformed or stale. |
| `validation.errors.invalid-filter` | A list filter is not valid. |
| `validation.errors.too-short` / `too-long` | A string is shorter or longer than its limit. |
| `validation.errors.too-few` / `too-many` | A list has fewer or more items than its limit. |
| `validation.errors.invalid-format` | A string does not match its format or pattern. |
