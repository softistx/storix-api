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
| `Workspace` | The tenant (`src/core/workspaces`). Registered in the core database, with its own database `storix_ws_<id>` (`MONGO_WORKSPACE_PREFIX`), named by the `x-storix-workspace` header (id or slug). Created `provisioning` with its first OWNER, then opened (`active`). |
| `Invitation` | An offer to join a workspace with a role, sent by e-mail (`src/core/invitations`, janus's invitation store in the core database). The code in the link is 43 characters of which only the sha256 is kept; it lives 7 days, and a workspace has one pending invitation per address. Accepting it makes the account if the address has none, and adds a `Member`. |
| `Member` | An account's place in a workspace (`src/core/members`, core database): a role, and `removedAt` once it left. Never a personal API key: keys are refused on workspace operations until they are bound to a workspace. |
| `Role` | `OWNER`, `ADMIN` or `MEMBER`. Permissions come from the modules' `defaultGrants`; OWNER holds all. Only an OWNER makes, demotes or removes an owner (`owners:manage`), and a workspace always keeps one. |
| `Team` | A named group of a workspace's members (`src/modules/teams`, the workspace's own database): `name`, unique in the workspace ignoring case, and `memberIds`, the ids of `Member` rows. Anyone reads teams (`teams:read`); OWNER and ADMIN change them (`teams:manage`). A member who leaves is taken out of every team. |
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
| `workspaces.errors.not-found` | The workspace does not exist, is not open yet, or the caller is not a member: the three are never told apart (404). |
| `workspaces.errors.workspace-required` | A workspace operation came without the `x-storix-workspace` header (400). |
| `workspaces.errors.slug-taken` | A workspace with this slug exists (409, field `slug`). |
| `workspaces.errors.last-owner` | The change (a demotion, a removal, leaving) would leave the workspace without an owner (409). |
| `members.errors.not-found` | No active member with this id in the workspace (404). |
| `invitations.errors.not-found` | No invitation with this id in the workspace, or the caller may not see it (404). |
| `invitations.errors.invalid` | An invitation code names no pending invitation: unknown, already used, revoked or past its 7 days; the reasons are never told apart (400). |
| `invitations.errors.not-pending` | The invitation was accepted or revoked, so it cannot be sent again or revoked (409). |
| `invitations.errors.limit` | The workspace already has 200 pending invitations (409). |
| `invitations.errors.already-member` | The address already belongs to a member of the workspace (409, field `email`). |
| `invitations.errors.password-required` | The invitee has no account yet and gave no password (400, field `password`). |
| `teams.errors.not-found` | No team with this id in the request's workspace; a team of another workspace is the same answer (404). |
| `teams.errors.name-taken` | Another team of the workspace has this name, in any case (409, field `name`). |
| `teams.errors.member-unknown` | An id given to `setTeamMembers` is not a current member of the workspace: malformed, unknown, of another workspace or of a member who left (400, field `memberIds`). |
| `validation.errors.invalid-input` | An input was refused as a whole; `extensions.fields` lists each field (400). |
| `validation.errors.invalid` | A field's value is not valid. |
| `validation.errors.out-of-range` | A number is outside its bounds. |
| `validation.errors.invalid-cursor` | A page cursor is malformed or stale. |
| `validation.errors.invalid-filter` | A list filter is not valid. |
| `validation.errors.too-short` / `too-long` | A string is shorter or longer than its limit. |
| `validation.errors.too-few` / `too-many` | A list has fewer or more items than its limit. |
| `validation.errors.invalid-format` | A string does not match its format or pattern. |
