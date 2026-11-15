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
| `Node` | A folder or a file of the workspace's tree (`src/modules/nodes`, the workspace's own database, one `nodes` collection; in GraphQL `Node` is an interface, `Folder` and `File` implement it): `name`, `parentId` (null for a root), `ancestors` (ids from the root down to the parent), `ownerId`, `treeRev`, `version`. Names are unique among siblings ignoring case; depth is at most 16. A file also holds `key`, `mimeType`, `size` (the storage's, never the caller's), `family`, `tags`, `meta`, `status` and `focalPoint`. |
| `Rendition` | A derived image of a file, written by the worker (`src/worker.ts`, `src/modules/files/files.renditions.*`) at `workspaces/<workspaceId>/files/<key>/<size>`: `thumb` (320 px) and `preview` (1600 px) WebP, from a JPEG, PNG, WebP or PDF (page 1); a picture also has four JPEG crops (`square` 1:1, `portrait` 4:5, `story` 9:16, `landscape` 16:9, the sizes of publix's presets) centred on its `focalPoint`. The `renditions` queue (`src/queues`) holds one job per file, enqueued by `addFile` after its commit, and a `crops` job per `setFocalPoint` (the crops redone from the stored original; a crop's `ETag` is the stored object's, so it changes with its pixels). `File.renditions` lists the sizes of a `READY` file. A file with renditions to make is `PROCESSING`; it becomes `READY`, or `FAILED` when only the previews failed (the original stays downloadable). |
| `Blob` | The record that an uploaded object was taken as a file (`src/modules/files`, a `blobs` collection): `key` (unique), `size`, `mimeType`, `refs` (nodes holding it: a copy shares the blob and raises it). `addFile` writes it with the file's node in one transaction; a key already recorded, of another workspace or kind, malformed or never uploaded is `files.errors.key-unknown`. A `files` object is readable at `/media` only while a live node of the caller's own tree holds its key. Once `refs` is 0 the orphan sweep removes the blob, its object and its sizes. |
| `Orphan sweep` | The `sweep` job (`bun run storage:sweep`, `sweepAll`): removes blobs with `refs` 0 and objects no blob records that were last written over 75 minutes ago, with their sizes. A recorded object is never removed; usage is untouched. |
| `Star` | A member's favourite (`src/modules/files`, a `stars` collection): `accountId`, `nodeId`; one per pair. `setStarred` makes or removes it; `starred` lists the latest first. Only the member's own live nodes are listed: a trashed node (or, once sharing exists, one no longer readable) is skipped when read, and its star stays, so a restore brings it back. |
| `Recent` | A file a member uploaded or opened (`recents` collection): `accountId`, `nodeId`, `at`; one per pair, a repeat moves it up, 200 kept per member (the oldest are removed when one is noted). `addFile` and `openFile` note it; `recentFiles` lists files only, the latest first. |
| `Quota` | A workspace's storage ceiling, `quotaBytes` on its core `workspaces` document (10 GiB by default, set by `bun run workspace:quota`). The `files` `PUT` refuses a declared length that does not fit (413 `quotas.errors.exceeded`) before reading the body; `addFile` refuses atomically. |
| `Usage` | The counters of a workspace (`workspaces.usage`): `bytes` (each blob once, shared blobs included once), `files`, `versionBytes`, `trashBytes`. Moved in the `addFile` transaction; `bun run quota:reconcile` recounts and fixes drift. The `storage` query shows them. |
| `Root` | A member's private top folder, "My files": made when they join (`onMemberJoined`), or on first use. Nobody else sees it until sharing exists; a root is never renamed or moved. |
| `AuditEvent` | One append-only record of a write in a workspace (`src/core/audit`, the workspace's own database): `at`, `actor`, `action` (`team.create`, `member.remove`, …), `target`, `ipHash` (a keyed HMAC of the client address, never the address) and `meta` (never a secret). Recorded by `audit.record` after the write committed; a failure to record is logged and never undoes the write. OWNER and ADMIN read it (`audit:read`). |
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
| `nodes.errors.not-found` | No node with this id in the caller's tree: unknown, malformed, of another workspace or another member's are never told apart (404). |
| `nodes.errors.name-taken` | A sibling of the folder already has this name, in any case (409, field `name`). |
| `nodes.errors.too-deep` | The folder would sit deeper than 16 levels, root included (409). |
| `nodes.errors.cycle` | A folder was moved into itself or into its own subtree (409). |
| `nodes.errors.conflict` | The node changed since the `version` the caller sent: a rename or a move came first (409). |
| `nodes.errors.not-a-folder` | The parent or destination is not a folder (400, field `parentId`). |
| `nodes.errors.move-too-large` | The moved folder holds more than 5,000 nodes (409). |
| `nodes.errors.root-locked` | A root was renamed or moved (409). |
| `files.errors.key-unknown` | `addFile` named a key that is not a recordable upload: another workspace's or kind's, malformed, never uploaded, empty, or already recorded (400, field `key`). |
| `files.errors.not-a-file` | `updateFile` named a folder: only a file has tags and metadata (400, field `id`). |
| `files.errors.copy-too-large` | The copied folder, with what it holds, has more than 5,000 nodes (409). |
| `files.errors.not-renderable` | `setFocalPoint` named a file that is not a JPEG, PNG or WebP picture: only these have crops (400, field `id`). |
| `files.errors.invalid-focal` | `setFocalPoint` got a coordinate that is not a number from 0 to 1 (400, field `focalPoint`). |
| `quotas.errors.exceeded` | The file does not fit in what the workspace has left of its quota (413). The `/media` PUT answers it from the declared length before reading the body (nothing is stored); `addFile` answers it when the recorded size does not fit (the object is deleted). |
| `storage.errors.too-large` | An upload is larger than its kind allows (413); `params.limitMib` is the limit. |
| `storage.errors.unsupported-type` | The content type is not one the kind accepts (`avatars`: JPEG, PNG, WebP), or the first bytes are not the declared type's (415). |
| `storage.errors.empty` | The upload has no bytes (400). |
| `storage.errors.rate-limited` | Too many uploads for this account in this workspace (429); `params.seconds` and `extensions.retryAfter` say when to retry, and the `Retry-After` header too. |
| `storage.errors.unavailable` | The object store did not answer, or is not configured (503). |
| `storage.errors.unprocessable` | A picture could not be decoded or made into its sizes (422). |
| `storage.errors.stalled` | The client sent nothing for 60 seconds during an upload (408). |
| `storage.errors.not-found` | No such file in the request's workspace; a key of another workspace and a refused reader are the same answer (404). |
| `storage.errors.range-not-satisfiable` | The `Range` starts past the end of the file (416). |
| `storage.errors.interrupted` | The body ended short of its `Content-Length`, or ran past it (400). |
| `validation.errors.invalid-input` | An input was refused as a whole; `extensions.fields` lists each field (400). |
| `validation.errors.invalid` | A field's value is not valid. |
| `validation.errors.out-of-range` | A number is outside its bounds. |
| `validation.errors.invalid-cursor` | A page cursor is malformed or stale. |
| `validation.errors.invalid-filter` | A list filter is not valid. |
| `validation.errors.too-short` / `too-long` | A string is shorter or longer than its limit. |
| `validation.errors.too-few` / `too-many` | A list has fewer or more items than its limit. |
| `validation.errors.invalid-format` | A string does not match its format or pattern. |
