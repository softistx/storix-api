# storix v1: implementation plan

Status: decided by the owner (answers to Q1 to Q10, 2026-11-13); §10 lists the decisions. Planning only: no code exists yet.
Written by the coordinating session's planner; the issues and the roadmap entries of §8 are created
from this file before any work starts ("Plans become issues and a roadmap").

Read before writing (all read-only): `~/.claude/CLAUDE.md`; the plugins `alxia-graphql-api` 0.29.2,
`alxia-react-router-bff` 0.67.1, `ui-ux` 0.14.1, `bun-api` 1.5.1; pulsarix (plan, api, ui, widget),
clavix (spec layout, roadmap), schoolz-api (`files`, `translations`), healthix (docs layout),
publix-api `src/modules/media` and publix-ui `app/modules/media`, `app/core/media`; the packages
`@softistx/alxia-media` 0.6.2, `@softistx/s3` 0.13.0, `@softistx/image` 0.6.0, `@softistx/janus` 0.59,
`@softistx/material` 3.204 / `material-core` 0.87 (`FileSource`), `@softistx/ai-*`.

## 1. Product and scope

storix is the softistx file manager: a workspace's files in folders, shared with people, teams and
links, searchable, versioned, and embeddable in other softistx products through a widget.

**v1 (settled by the owner)**

- Folders and files: upload, rename, move, copy, tags, favourites, recents.
- Previews: images, PDF, video and audio (streamed with `Range`), text and code.
- Image renditions, focal point and crops (ported from publix).
- Versions, and a trash, both with retention.
- Sharing to people and teams with roles (viewer, editor), with notifications.
- Share links: expiry, password, read-only or upload (drop), revocable.
- Search: full text, plus AI tags and OCR.
- Storage quota per workspace.
- Consumers: an API key per workspace (janus's built-in keys, tied to a workspace by a thin storix module); scoped short-lived tokens; the widget in two forms.

**Out of v1**: desktop sync client, billing, offline mode, collaborative editing. Also not in v1,
by this plan: office-document conversion, server-side video posters and transcoding, files larger
than one request (see Q1), realtime updates, custom rendition presets, a platform-admin console.

**Later, separate effort**: publix moves its media library onto storix (§11).

## 2. Repositories, stack, conventions

| Repository | What | Lives in |
| --- | --- | --- |
| `softistx/storix-api` | GraphQL API (Bun, alxia, graxia) and its queue worker | `~/workspace/dev/storix/storix-api` |
| `softistx/storix-ui` | React Router 8 BFF on `@softistx/alxia-react-router`, `@softistx/material` | `~/workspace/dev/storix/storix-ui` |
| `softistx/storix-widget` | `@softistx/storix-widget`: script loader (Shadow DOM) and a `FileSource` | `~/workspace/dev/storix/storix-widget` |

- `~/workspace/dev/storix/` is the coordinating folder (as pulsarix's): `AGENTS.md`, `docs/plan.md`,
  `docs/roadmap.md`, `docs/resume.md`. It is not a repository and holds no worktree.
- Branches: `develop` default, `main` follows fast-forward. One integration branch `feat/<slug>`
  per effort and per repository; slices are PRs into it; one PR from it into `develop`.
- An API slice lands in `storix-api`'s `develop` (or its effort branch, with the schema copy
  handed over) before the UI or widget slice that uses it; the UI works on its mock API meanwhile.
- Conventions: the two alxia plugins, `ui-ux` and `bun-api`, without departure. Where pulsarix
  departed (error texts in code), storix follows the plugin (texts in the database, §3.13).
- Packages: `@softistx/alxia`, `graphql`, `env`, `i18n`, `language`, `modules`, `tenancy`, `access`,
  `media`; `@softistx/mongo`, `redis`, `s3`, `image`, `mail`, `mail-smtp`, `janus`, `janus-mongo`,
  `janus-graphql`, `janus-mail`, `telemetry`, `ai-core`, `ai-anthropic`, `ai-ollama`,
  `ai-telemetry`, `ai-testing`; `@nxgt/graphql-scalars`, `graphql-validation`, `graphql-client`;
  UI: `@softistx/alxia-react-router`, `@softistx/alxia-secure-headers`, `@softistx/material`, `material-core`,
  `@softistx/zod`. No third-party client where one of these exists.
- Type checking is `bun check`; Biome's scripts are `lint` and `fix`. The green bar is
  `bun run verify`; CI is one job on `pull_request` into `develop` running `verify:pr`.
- Languages: English by default, French offered (API messages, UI, widget, mails).

## 3. Architecture

### 3.1 Processes and request paths

```
browser (storix-ui pages) ──► storix-ui BFF ──► storix-api /graphql, /media   (session Bearer, proxy secret)
visitor of a share link   ──► storix-ui BFF ──► storix-api /graphql, /media   (link grant, proxy secret)
consumer server (publix…) ─────────────────────► storix-api /graphql, /media   (workspace API key: a janus key)
widget in a consumer page ─────────────────────► storix-api /public/graphql, /public/media (scoped token, CORS)
storix-api ──► MongoDB (core db + one db per workspace), Redis (limits, queues, tokens), S3 (one private bucket)
storix-worker (dist/worker.js) ──► the same three: renditions, extraction, AI, retention, sweeps, mails
```

- The browser never calls the API and never sees a storage URL. Bytes go browser → BFF `/media`
  route → API `@softistx/alxia-media` routes → private bucket. No presigned URL anywhere.
- `/public/*` is the only surface a third-party origin reaches. It is served by storix-api and
  routed on the storix host by the deploy stack, as pulsarix's `/public/graphql` is.
- The worker is a second entry of storix-api (`src/worker.ts`), as publix-api's.

### 3.2 storix-api modules

`src/core/` is the kernel (no business module imported); `src/modules/registry.ts` is the one
list of modules (`@softistx/alxia-modules`). Each module follows `<name>.<role>.ts`.

| Module | Where | Owns |
| --- | --- | --- |
| `identity` | core | the `Identity` port and its janus adapter (§3.11): sign-in, sessions, reset, e-mail verification, TOTP, step-up |
| `workspaces` | core | workspaces (the tenant), settings (retention, link policy, AI opt-in), the per-workspace database |
| `members` | core | membership and workspace roles (`OWNER`, `ADMIN`, `MEMBER`) |
| `invitations` | core | invitations by e-mail, proved by their token |
| `access` | core | permissions `<area>:<action>`, guards, the effective role of a caller on a node |
| `translations` | core | error and mail texts in the database, `errorCatalogue` |
| `audit` | core | the append-only audit log and its query |
| `teams` | modules | teams of members |
| `nodes` | modules | the tree: folders and files as one `nodes` collection; create, rename, move, copy, list |
| `files` | modules | recording an upload (`addFile`), blobs, tags, metadata, favourites, recents |
| `storage` | modules | the bucket, the media kinds, `/media` routes, upload rate limit, orphan sweep |
| `renditions` | modules | thumbnails, previews, the five crop presets, focal point, PDF first page |
| `versions` | modules | versions of a file, restore, retention |
| `trash` | modules | trash, restore, purge, retention |
| `shares` | modules | grants to members and teams (viewer, editor), "shared with me" |
| `links` | modules | share links: download and drop, password, expiry, revocation |
| `search` | modules | the search documents, the text index, the `search` query |
| `extraction` | modules | text extraction, OCR and AI tags (worker) |
| `quotas` | modules | usage counters, the quota check, the storage breakdown |
| `notifications` | modules | the inbox and the mails of sharing events |
| `usages` | modules | where a consumer uses a file (ported from publix `media.usage`) |
| `api-keys` | modules | a thin module over janus's keys: ties each key to a storix workspace, its scopes, origins and app space (§3.7); the key store, secret, hash, expiry and revocation stay janus's |
| `tokens` | modules | scoped tokens for the widget (Redis) |
| `public` | modules | `/public/graphql` (persisted operations) and `/public/media`, CORS, origins |

### 3.3 Data model

Tenancy as pulsarix and publix: a **core database** and **one database per workspace**
(`@softistx/alxia-tenancy`). Every model is a `defineCollection` with `timestamps` and `actors`; ids are
ObjectIds; account ids are opaque strings from the identity port.

**Core database**

| Collection | Key fields | Key indexes |
| --- | --- | --- |
| janus stores | users, sessions, tokens, second factors (`@softistx/janus-mongo`) | the adapter's |
| `workspaces` | `slug`, `name`, `quotaBytes`, `usage {bytes, files, versionBytes, trashBytes}`, `settings {trashDays, versionsMax, versionsDays, linkMaxDays, linkPasswordRequired, ai {enabled, monthlyBudget}}`, `version` | `slug` unique |
| `members` | `workspaceId`, `accountId`, `role`, `removedAt` | `{workspaceId, accountId}` unique; `{accountId}` |
| `invitations` | `workspaceId`, `email`, `role`, `tokenHash`, `expiresAt` | `tokenHash` unique; `{workspaceId, email}` |
| `apiKeyBindings` | `apiKeyId` (janus's key id), `workspaceId`, `label`, `scopes[]`, `rootFolderId`, `allowedOrigins[]`, `active`, `createdBy` (account) | `apiKeyId` unique; `{workspaceId, apiKeyId}`; `{allowedOrigins}`. Secret hash, prefix, expiry, revocation and last use are janus's (`createMongoApiKeys`), never copied |
| `linkIndex` | `tokenHash`, `workspaceId`, `linkId` | `tokenHash` unique (a link is found before its workspace is known) |
| `translations` | code, language, text (written by data migrations) | `{code, language}` unique |

**Workspace database**

| Collection | Key fields | Key indexes |
| --- | --- | --- |
| `nodes` | `type` (`FOLDER`, `FILE`), `name`, `parentId` (null = a root), `ancestors[]` (root first), `ownerId` (account) or `spaceId` (an API key's app space), files: `currentVersionId`, `blobKey`, `mimeType`, `size`, `family`, `width`, `height`, `durationMs`, `tags[]`, `meta{}`, `focalPoint`, `renditions[]`, `status` (`READY`, `PROCESSING`, `FAILED`), `trashedAt`, `trashedBy`, `trashRootId`, `treeRev`, `version`; soft delete, optimistic lock | `{parentId, name}` unique, collation `en` strength 2, partial on live and not trashed; `{parentId, type, name, _id}`; `{parentId, updatedAt, _id}`; `{parentId, size, _id}`; `{ancestors}`; `{ownerId, parentId}`; `{tags}`; `{trashedAt}` partial; `{blobKey}` |
| `versions` | `fileId`, `number`, `blobKey`, `size`, `mimeType`, `createdBy`, `note`, `restoredFrom` | `{fileId, number}` unique; `{blobKey}`; `{createdAt}` |
| `blobs` | `key` (the media key), `size`, `mimeType`, `refs` (count of nodes, versions and copies holding it), `releasedAt` | `key` unique; `{refs, releasedAt}` |
| `grants` | `nodeId`, `principal {type: MEMBER or TEAM, id}`, `role` (`VIEWER`, `EDITOR`), `grantedBy` | `{nodeId, principal.type, principal.id}` unique; `{principal.type, principal.id}` |
| `teams` | `name`, `memberIds[]` | `name` unique (collation); `{memberIds}` |
| `stars` | `accountId`, `nodeId` | `{accountId, nodeId}` unique |
| `recents` | `accountId`, `nodeId`, `at` (capped at 200 per account) | `{accountId, at}`; `{accountId, nodeId}` unique |
| `links` | `nodeId`, `mode` (`VIEW`, `DROP`), `tokenHash`, `hint`, `passwordHash`, `expiresAt`, `revokedAt`, `maxDownloads`, `downloads`, drop: `maxFiles`, `maxBytes`, `accept[]`, `received {files, bytes}`, `label`, `lastUsedAt` | `{nodeId}`; `{createdBy}`; `{expiresAt}` |
| `usages` | `fileId`, `app`, `refType`, `refId`, `label`, `url` | `{fileId}`; `{app, refType, refId, fileId}` unique |
| `searchDocs` | `nodeId`, `name`, `tags[]`, `aiTags[]`, `text` (extracted, at most 200 KB), `language`, `ancestors[]`, `ownerId`, `spaceId`, `family`, `extraction {state, at, source}` | text index on `name` (10), `tags` (5), `aiTags` (3), `text` (1); `nodeId` unique; `{ancestors}` |
| `notifications` | `accountId`, `kind`, `nodeId`, `actorId`, `readAt` | `{accountId, readAt, _id}` |
| `auditEvents` | `at`, `actor {type: MEMBER, API_KEY, TOKEN, LINK; id; label}`, `action`, `target {type, id, name}`, `ipHash`, `meta` | `{at, _id}`; `{target.id, at}`; `{actor.id, at}`; TTL 365 days |

Rules that follow from the model:

- **One tree, one collection.** A folder listing is one query, folders first, one cursor; names
  are unique among the live siblings of a parent, ignoring case, for files and folders alike.
- **`ancestors` makes subtree questions one index read**: inherited grants, trash cascades,
  "is this inside the token's folder", search scoping. A folder move rewrites the `ancestors` of
  its subtree in one transaction up to 5,000 nodes; above that it is refused
  (`nodes.errors.move-too-large`) until the batched move of Next. Depth is at most 16.
- **A storage key never encodes a name or a folder**: rename and move rewrite nothing in S3.
- **A copy, a restored version and a restored file share a blob** (`blobs.refs`): no S3 copy
  is needed (`@softistx/s3` has none). A blob is removed by the sweep once `refs` is 0.
- `treeRev` and `version` serialise concurrent tree writes as publix's `media-folders.tree.ts`.

### 3.4 Storage layout on S3 (SeaweedFS locally)

- One private bucket (`S3_BUCKET`, `storix` locally), bound with `@softistx/s3` `bindBucket`.
  Local and test storage is SeaweedFS (`@softistx/s3/testing` in specs, a compose service in
  `bun run dev`). No public hostname, no CORS rule, no `S3_PUBLIC_ENDPOINT`.
- Keys, through `@softistx/alxia-media`'s `keyPrefix`: `workspaces/<workspaceId>/<kind>/<key>` and
  `workspaces/<workspaceId>/<kind>/<key>/<size>` for a rendition. `<key>` is a UUID.
- Kinds (`storage.kinds.ts`):

| Kind | Accepts | Max bytes | Sizes | Notes |
| --- | --- | --- | --- | --- |
| `files` | any type (needs UP-1) | 95 MiB (Q1) | `thumb`, `preview`, `square`, `portrait`, `story`, `landscape` | sniffed where a signature is known; a type outside the inline-safe list is served as `attachment` |
| `avatars` | JPEG, PNG, WebP | 10 MiB | `s`, `m` | account and workspace pictures, `keepOriginal: false` |

- `cacheControl: 'private, no-cache'` on `files`: a reader can lose access (a revoked grant, a
  revoked link), so every use revalidates, `authorizeRead` runs, and an unchanged file costs a
  `304`. It also lets a rendition change under the same address when the focal point moves.
- Renditions are made by the worker after the upload (not inside the `PUT`), written at
  `mediaPlace(kind, prefix)(key, size)` so the package's `GET …/<size>` serves them once
  present. Until then the node is `PROCESSING` for its previews only; the original is readable.
- Deleting a workspace drops its database and its `workspaces/<id>/` prefix (a script, behind
  the owner's yes: it deletes data).

### 3.5 Upload and download flows

**Upload (every caller)**: `PUT <media>/files` with a `Content-Length` → `{ key, contentType,
size }` → GraphQL `addFile({ key, name, parentId, onConflict })` records it: the object must be
under this workspace and kind and not recorded yet; type and size are the storage's, never the
input's. `onConflict` is `REFUSE` (default, `nodes.errors.name-taken`), `NEW_VERSION` or
`KEEP_BOTH` (`name (1).ext`). An unrecorded object waits for the orphan sweep.

Order of checks in the `PUT`: authorisation (role, token scope, link mode) → upload rate limit →
declared length against the remaining quota (`quotas.errors.exceeded`, 413) → type → size →
signature. `addFile` checks the quota again, authoritatively, in the transaction that raises the
usage counters; a refusal there deletes the object.

**Download**: `GET <media>/files/<key>[/<size>]`, streamed, `Range`, `ETag`, `If-None-Match`,
`If-Range` (the package's). `authorizeRead(ctx, key)` finds the node or version holding the key
and asks `access` for the caller's effective role; a refusal and a missing object are the same
404. A download with a name is the page's `<a download="<name>">` on its own origin.

**Rate limits** (`@softistx/redis` `defineRateLimit`, behind the Throttle port): uploads per
account and workspace 30 a minute with a burst of 60 (publix's); per API key 600 a minute; per
scoped token 60 a minute; per link see §3.8. Uploads fail closed when Redis does not answer.

### 3.6 Access model

- **Workspace roles**: `OWNER` (everything, deletes the workspace), `ADMIN` (members, teams,
  settings, API keys, audit, storage), `MEMBER` (own files and what is shared with them).
- **Ownership (Q2)**: each member has a private root ("My files"). A node belongs to the owner
  of its root. Nothing is visible to another member until shared. An admin does not browse
  private files; removing a member transfers their root to an admin they choose.
- **Grants**: `VIEWER` (list, preview, download) or `EDITOR` (plus upload, rename, move inside,
  new version, trash) on a file or a folder, to a member or a team; a folder's grant covers its
  subtree. The effective role is the highest of: owner, direct grant, a grant on any ancestor,
  a team's grant. Only the owner and editors share further; only the owner or an admin deletes
  for good.
- **App spaces**: an API key owns a root folder (`spaceId`) that no member's root contains.
  Admins see app spaces under Settings › API keys ("Open folder"), read-only by default.
- **Guards first** in every resolver; `access.roleOn(caller, nodeId)` is the one function the
  node, version, link, media and search code asks. Lists never leak a name the caller cannot
  read: counts, breadcrumbs and search results are filtered by the same function.

### 3.7 Token model for consumers and the widget

| Credential | Who holds it | Format and storage | Lifetime | Opens |
| --- | --- | --- | --- | --- |
| Session token | storix-ui's cookie | janus session | janus's | `/graphql`, `/media` as the member |
| Workspace API key | a consumer's server only | a janus API key (`createMongoApiKeys` from `@softistx/janus-mongo`; janus's format, hash and shown-once secret); its `apiKeyBindings` row gives the workspace | janus's expiry; revocable; `active` switch on the binding | `/graphql` and `/media` within its scopes and its app space |
| Scoped token | the browser, through the widget | `stxt_<random 256 bit>`; `sha256` → Redis hash `{workspaceId, keyId, folderId, mode, subject, origin, limits}` with a TTL; `tokens:<keyId>` set for revocation | default 15 min, at most 60 min | `/public/graphql`, `/public/media` inside one folder subtree |
| Link grant | a visitor's httpOnly cookie on the storix host, path `/s/<token>` | random 256 bit; Redis, 30 min sliding, at most 12 h | until expiry, link revocation or password change | that one link |

- **How a key is recognised (Q4, as self-learning-api)**: the viewer resolver calls
  `auth.accounts.authenticate(request, { apiKey: true })`; a key-shaped bearer authenticates as
  the key's owner with `via: "apiKey"`, and the storix viewer carries `apiKeyId`. The role is
  read on each request. A key request is never treated as its owner acting as a member: the
  `api-keys` module loads the binding by `apiKeyId` (missing, inactive, or its workspace not the
  request's → 401) and the access layer sees principal `API_KEY` with the binding's scopes and
  space. A middleware lists the only paths a key reaches, `/graphql`, `/media`, `/health`,
  `/ready`, and answers every other path (`/public/*`, account routes, any route added later)
  with 401 `auth.errors.api-key-not-accepted`, as self-learning-api's `refuseKeyOutsideKeyPaths`.
  Inside `/graphql`, operations a key may not call (members, teams, settings, audit, key
  management, account operations) answer `api-keys.errors.scope-denied`.
- **API key scopes**: `files:read`, `files:write`, `shares:write`, `tokens:mint`, `usages:write`.
  A key reaches only its app space unless an admin grants it another folder (a grant to the key,
  same `grants` collection, principal `API_KEY`). A key never creates a key, never manages
  members, never reads the audit log. Creating or revoking one needs a fresh session (step-up); the
  mutations call janus (`auth.accounts.apiKeys` create, revoke) and write or flip the binding.
  A key's owner is the admin who created it; removing that admin from the workspace disables
  the keys they created, and their transfer to another admin is an explicit action.
- **Minting** (`mintAccessToken`, API key with `tokens:mint`): input `folderId` (inside what the
  key reaches), `mode` `READ` or `UPLOAD`, `ttlSeconds` (60 to 3600), `origin` (one of the key's
  `allowedOrigins`), `subject` (the consumer's opaque user id, at most 100 characters, kept for
  the audit log), optional `accept[]`, `maxBytes`, `maxFiles`. Answer: `{ token, expiresAt }`.
- **`READ`** lists, searches, previews and downloads inside the folder. **`UPLOAD`** adds
  uploading and creating folders there; it never renames, moves, trashes or shares. Files a
  token uploads are owned by the key's app space, with `subject` in the audit event.
- **Checks on every `/public` request**: the token exists in Redis; the `Origin` header equals
  the token's origin; the target node has the token's folder in its `ancestors`; the key is
  still active and unrevoked (read with the token, cached 30 s).
- **Revocation**: `revokeAccessToken(token)`; revoking or disabling a key deletes every token
  of `tokens:<keyId>`; a Redis outage refuses every scoped token (fail closed).
- **The browser never sees the API key.** The widget takes `getToken()`, a function the host
  page implements by calling its own server, which calls `mintAccessToken` with the key.

### 3.8 Share-link security

- **Token**: 256 random bits, base64url, in the path `/s/<token>`. Only `sha256(token)` is
  stored (`linkIndex`, `links`); the link is shown in full once at creation and can be
  re-issued (a new token), never read back. `hint` keeps the last 4 characters for lists.
- **Password**: optional (a workspace policy can require it), 8 to 200 characters, hashed with
  the identity port's hasher (the one janus uses, argon2id through `Bun.password`), never
  logged, never in an audit event. A correct password opens a link grant (§3.7); changing or
  removing the password ends every grant of the link.
- **Expiry**: required, default 7 days, at most `settings.linkMaxDays` (365 by default) (Q6).
  Optional `maxDownloads`. Revocation is immediate (the row keeps `revokedAt`, the index entry
  goes).
- **No enumeration**: an unknown, expired, revoked or exhausted token, and a link whose node
  is trashed, all answer the same 404 `links.errors.not-found` with the same body and a
  constant-time comparison; no link id, workspace name or owner e-mail appears before the
  password is passed. Answers carry `Cache-Control: no-store`, `X-Robots-Tag: noindex`,
  `Referrer-Policy: no-referrer`. The token is never sent to the audit log or to telemetry.
- **Rate limits**: resolving a link, 60 a minute per address; password attempts, 5 per 10
  minutes per address and link, 50 an hour per link, then the link locks for 15 minutes
  (`links.errors.locked`, with `retryAfter` and `minutes`); drop uploads, 30 an hour per
  address and link. The address is the forwarded one, trusted only with the proxy secret.
- **`VIEW` link**: a file (preview and download) or a folder (browse its subtree, read-only).
  The media read is authorised by the link grant and the node's `ancestors`.
- **`DROP` link** (upload only): the visitor uploads into the folder and sees only what they
  sent in this visit, never the folder's content. Caps: `maxFiles`, `maxBytes`, `accept[]`,
  the per-file limit, and the workspace quota (a full workspace answers
  `links.errors.drop-closed`, not the quota figure). Files arrive owned by the link's owner
  with the audit actor `LINK`; the owner is notified (batched per visit).
- Links to a node are listed and revoked by its owner, its editors and admins; a member
  removed from the workspace has their links revoked.

### 3.9 Versions, trash, retention, quotas

- **Versions**: `addFile` with `NEW_VERSION`, or `addFileVersion(fileId, key, note)`, appends a
  version and moves `currentVersionId`; renditions, extraction and tags are redone for it.
  `restoreFileVersion` appends a new version holding the old blob. Retention keeps the newest
  `versionsMax` (20) and drops versions older than `versionsDays` (90), never the current one.
- **Trash**: `trashNodes(ids)` sets `trashedAt`, `trashedBy` and, on a folder's subtree,
  `trashRootId` (one `updateMany` on `ancestors`). Trashed nodes leave lists, search, links
  (404) and grants' effect. `restoreNodes` puts them back (to the owner's root, with a
  suffixed name, when the parent or the name is gone). `purgeNodes` and `emptyTrash` delete for
  good (owner or admin). The retention job purges after `trashDays` (30).
- **Purge** removes the node, its versions, grants, stars, links, usages, search document,
  decrements `blobs.refs`; the sweep removes released blobs and their renditions.
- **Quota**: `workspaces.quotaBytes` (default 10 GiB, Q8), set by a platform script
  (`bun run workspace:quota <slug> <bytes>`): there is no billing in v1. `usage` counts the
  bytes of blobs with `refs > 0` (so versions and trash count, Q9), raised and lowered in the
  transaction that changes a ref; a nightly job reconciles it. The UI shows used, quota and the
  split current / versions / trash; warnings at 85 % and 95 % (material's `getUsage` footer),
  a notification to admins at both thresholds.
- **In use**: trashing a file with `usages` asks for a confirmation in the UI and is refused to
  an API key unless `force: true` (`files.errors.in-use`, ported from `media.in-use`).

### 3.10 Previews, search and the AI pipeline

A recorded version enqueues jobs (`@softistx/redis` queues, the worker):

1. **Renditions** (`@softistx/image`): for JPEG, PNG and WebP, `thumb` (320 px, WebP),
   `preview` (1600 px, WebP) and the four crops centred on the focal point; for a PDF,
   `thumb` and `preview` of page 1 (`@softistx/image/pdf`). Animated images, video and audio
   keep their family icon in v1 (UP-6). A picture that cannot be decoded is `FAILED` for its
   previews only.
2. **Text extraction**: text and code files as they are; a PDF's text layer (UP-5); nothing
   else in v1. Capped at 200 KB of text per file.
3. **AI tags and OCR**, only when the workspace opted in (Q3) and its monthly budget holds:
   `generate` of `@softistx/ai-core` with a structured output (zod: `tags` up to 12,
   `text`, `language`, `description`) over an `image` part (the `preview` rendition) or the
   rendered pages of a PDF without a text layer (first 5 pages, UP-5). Adapter from env:
   `@softistx/ai-anthropic` hosted, `@softistx/ai-ollama` self-hosted; usage through
   `@softistx/ai-telemetry`, counted per workspace; specs on `@softistx/ai-testing`'s
   `fakeModel`. The model's output is data: it is stored as `aiTags` and `text`, never executed
   and never shown as markup.

**Search**: `search(query, filter, first, after)` runs `$text` on `searchDocs` with the
caller's scope in the same query (`ownerId` is the caller, or `ancestors`/`nodeId` in the
caller's granted set, or the token's folder), ranked by text score then recency; filters:
family, tags, owner, folder subtree, modified range. Each hit says where it matched (name, tag,
AI tag, content) with a snippet of at most 200 characters. The file-name substring filter of a
folder listing stays a separate, cheap path (collation index). Search documents follow rename,
move, trash and purge in the same transaction as the node.

### 3.11 Identity seam (janus now, clavix later)

- `src/core/identity/identity.port.ts` is the only thing the rest of the API knows:
  `authenticate(request) → Principal | null` (`{ accountId, email, name, authenticatedAt,
  secondFactor }`), `accounts.byIds(ids)` (a DataLoader source), `accounts.byEmail`,
  `assertFresh(principal, maxAge)`, `hasher` (`hash`, `verify`), and the invitation token
  mechanics. `services/identity.janus.ts` implements it with `@softistx/janus*`; `config/auth.ts` wires it.
- Every other module stores `accountId` as an opaque string and never imports a janus package
  (a dependency check in `verify`: only `src/core/identity/**` and `src/config/auth.ts` may).
- The account operations of the schema (`signIn`, `signOut`, reset, verification, TOTP,
  step-up) live in `identity.graphqls`; nothing else in the schema names janus types.
- In storix-ui, `app/core/session/` is the same seam: its sign-in pages and cookie are the
  only identity code; pages and features read `requireViewer()`.
- **The switch to clavix** then touches: `identity.clavix.ts` (validate clavix-issued tokens,
  read accounts from its userinfo), the removal of `identity.graphqls`' password operations,
  `app/core/session/` (an OIDC redirect instead of the sign-in forms), and a one-off
  account-id mapping migration. Workspaces, members, roles, grants, key bindings, scoped tokens
  and share links are storix's own and do not move. The key secrets are janus's: the port
  exposes `apiKeys` (create, revoke, list, authenticate), and the switch re-issues keys behind
  the same bindings, a cost told to consumers in advance (a slice of that effort).

### 3.12 GraphQL surface (outline)

One `/graphql` entry point, the committed `schema.graphql`, cursor connections, `@constraint`
on inputs, keys never URLs. Session or API-key principal unless said.

```graphql
# identity (session only)
viewer: Viewer            signIn / signOut / requestPasswordReset / resetPassword
verifyEmail / enrolSecondFactor / confirmSecondFactor / stepUp
# workspaces, members, invitations, teams
workspace: Workspace!     createWorkspace / updateWorkspace / updateWorkspaceSettings
members(first, after): MemberPage!     changeMemberRole / removeMember(transferTo)
invitations: [Invitation!]!            inviteMember / revokeInvitation / acceptInvitation(token)
teams: [Team!]!  team(id)              createTeam / renameTeam / setTeamMembers / deleteTeam
# tree
node(id): Node            nodes(parentId, filter, sort, first, after): NodePage!
nodePath(id): [Node!]!    folders(parentId): [Node!]!     roots: [Node!]!
createFolder / renameNode(version) / moveNodes(ids, parentId) / copyNodes(ids, parentId)
addFile(input) / updateFile(id, {tags, meta}) / setFocalPoint(id, focalPoint)
# favourites, recents, storage
starred(first, after)     setStarred(id, starred)     recentFiles(first, after)
storage: Storage!         # used, quota, breakdown
# versions and trash
File.versions: [FileVersion!]!   addFileVersion / restoreFileVersion / deleteFileVersion
trash(first, after): NodePage!   trashNodes / restoreNodes / purgeNodes / emptyTrash
# sharing
Node.grants: [Grant!]!    Node.myRole: Role!    sharedWithMe / sharedByMe
shareNode(id, principal, role) / changeGrant / unshareNode
# links (team side)       Node.links: [ShareLink!]!   shareLinks(first, after)
createShareLink(input): ShareLinkCreated!   # the only answer that carries the token
updateShareLink / reissueShareLink / revokeShareLink
# links (visitor side, anonymous, counted and throttled)
shareLink(token): PublicLink              openShareLink(token, password): LinkGrant!
linkNodes(token, parentId, first, after)  addDroppedFile(token, key, name)
# search, notifications, usages, audit
search(query, filter, first, after): SearchPage!     tags(first): [TagCount!]!
notifications(first, after) / markNotificationsRead
File.usages / File.usageCount     setFileUsage(input) / removeFileUsage(input)
auditEvents(filter, first, after): AuditPage!        # admins
# consumers
apiKeys: [ApiKey!]!   createApiKey(input): ApiKeyCreated!   updateApiKey / revokeApiKey
#   (binding: workspace, scopes, space, origins; the secret is janus's, shown once, in ApiKeyCreated)
mintAccessToken(input): AccessToken!   revokeAccessToken(token)    # API key only
# catalogue
errorCatalogue(language): ErrorCatalogue!
```

`/public/graphql` (scoped token, CORS) accepts **persisted operations only**, named by id, as
pulsarix's intake does: `widgetSession` (mode, folder, limits, expiry), `publicNodes`,
`publicFolders`, `publicNodePath`, `publicSearch`, `publicAddFile`, `publicCreateFolder`,
`publicStorage`. `/public/media` mounts the same `files` kind behind the token middleware.

`Node` is an interface (`Folder`, `File`); `File` carries `key`, `mimeType`, `size`, `family`,
`tags`, `aiTags`, `focalPoint`, `renditions`, `rendition(preset)`, `status`, `versions`,
`usages`; `Folder` carries `childCount`, `hasFolders`, `size`.

### 3.13 Error-code catalogue

Codes are `<module>.errors.<slug>`, declared per module with `defineCodes`, unioned into
`ErrorCode`; messages (ICU, English and French) are data in `translations`, written by data
migrations, served by `Query.errorCatalogue(language)` with a `version`, as schoolz-api. A
refusal carries `extensions.code`, `params`, `http.status` and `field`. `/media` and `/public`
refusals use the same shape. `coverage.spec.ts` requires a message per code and language and a
CONTEXT.md row. Shared namespaces: `auth.errors.*`, `validation.errors.*`.

| Module | Slugs |
| --- | --- |
| `auth` | `unauthenticated`, `forbidden`, `step-up-required`, `second-factor-required`, `rate-limited`, `api-key-not-accepted` (401, a key on a path it may not reach) |
| `validation` | `invalid-input`, `invalid`, `out-of-range`, `invalid-cursor`, `invalid-filter` |
| `identity` | `invalid-credentials`, `email-taken`, `email-unverified`, `token-invalid`, `second-factor-invalid` |
| `workspaces` | `not-found`, `slug-taken`, `conflict`, `last-owner` |
| `members` | `not-found`, `already-member`, `transfer-required` |
| `invitations` | `not-found`, `expired`, `already-accepted`, `rate-limited` |
| `teams` | `not-found`, `name-taken`, `member-unknown` |
| `nodes` | `not-found`, `name-taken`, `too-deep`, `cycle`, `conflict`, `not-a-folder`, `move-too-large`, `too-many` |
| `files` | `key-unknown`, `not-a-file`, `in-use`, `not-renderable`, `invalid-focal` |
| `storage` | `too-large`, `unsupported-type`, `empty`, `rate-limited`, `unavailable`, `unprocessable`, `stalled` |
| `versions` | `not-found`, `is-current`, `limit` |
| `trash` | `not-trashed`, `restore-conflict` |
| `shares` | `not-found`, `principal-unknown`, `already-shared`, `owner-only` |
| `links` | `not-found`, `password-required`, `password-invalid`, `locked`, `drop-closed`, `drop-limit`, `policy` |
| `search` | `query-too-short`, `unavailable` |
| `quotas` | `exceeded` |
| `ai` | `disabled`, `budget-exceeded` |
| `api-keys` | `not-found`, `limit`, `scope-denied`, `origin-required`, `binding-missing` |
| `tokens` | `invalid`, `expired`, `origin-not-allowed`, `out-of-scope`, `mode-denied` |
| `public` | `persisted-only`, `unsupported-media` |

### 3.14 Background jobs (worker)

| Job | Trigger | Does |
| --- | --- | --- |
| `renditions` | a recorded version; a focal change | makes and stores the sizes, sets `status` |
| `extraction`, `ai` | a recorded version; AI opt-in turned on (backfill, paced) | fills `searchDocs` |
| `mails` | notifications, invitations, janus mails | sends through `@softistx/mail-smtp` |
| `retention` | hourly | purges trash and old versions per workspace settings |
| `sweep` | hourly | removes blobs with `refs` 0 and unrecorded objects older than 75 minutes |
| `reconcile` | nightly | recomputes `workspaces.usage`, expires `linkIndex` rows |

## 4. storix-ui screens

Shell: material's `AppShell`; side menu of six destinations (Files, Shared, Recent, Favourites,
Trash, Settings); app bar with the workspace switcher, the search field (`Cmd+K`), the
notification bell, the help button and the account menu. Every screen: phone and desktop,
light and dark, WCAG 2.2 AA, the states loading, empty (nothing yet / nothing matches), error
with retry, and refused (worded from the error catalogue). Records open read-only; sections
are edited in place; peer sections are tabs (pill bar, `?tab=`, short labels with counts).

| # | Route | Screen | Tabs and notable states |
| --- | --- | --- | --- |
| S1 | `/` | Landing page for a guest (hero, features, widget, security, footer); a signed-in visitor is sent to their workspace | public, indexed |
| S2 | `/privacy`, `/terms` | Legal pages | public |
| S3 | `/sign-in`, `/sign-in/second-factor`, `/sign-up`, `/forgot-password`, `/auth/reset-password`, `/auth/verify-email` | Auth pages (`AuthCard`) | wrong credentials, throttled, expired link, unverified e-mail |
| S4 | `/invitations/accept` | Accept an invitation | expired, already accepted, signed in as another account |
| S5 | `/workspaces`, `/workspaces/new` | Workspace picker (`WorkspacePicker`) and creation form | no workspace yet; slug taken |
| S6 | `/w/:slug/files/:folderId?` | **My files**: `FileManager` (breadcrumb, opt-in tree, grid and list, details panel, uploads, bulk bar, drag to move) | empty folder with Upload; uploading, processing, refused file (type, size, quota); storage footer with 85 % and 95 % warnings; name conflict dialog (replace as a new version, keep both) |
| S7 | `/w/:slug/file/:id` | **File page** (read-only record, identity banner with name, family, size, owner, role) | tabs: Overview (preview, tags, description, focal point and crops for an image, edited in place) · Versions (n) · Sharing (n) · Usage (n) · Activity; states: processing, preview failed, viewer role (no Edit), trashed (badge, Restore) |
| S8 | fullscreen viewer (from S6, S7, S10, S12) | `FileViewersProvider`: `PdfReader`, `MediaPlayer`, `AudioPlayer`, image gallery, read-only code viewer; previous and next | unsupported type → download card |
| S9 | share dialog (from S6, S7) | **Share**: people and teams with a role; links (create, copy, expiry, password, mode) | a dialog on purpose: a short self-contained edit of a list (owner's rule of 2026-11-13); the record still opens read-only, Sharing tab lists the same grants |
| S10 | `/w/:slug/shared` | **Shared** | tabs: With me (n) · By me (n) · Links (n); empty states per tab; revoked or expired link badge |
| S11 | `/w/:slug/recent`, `/w/:slug/favourites` | Recent and Favourites (flat `FileManager` scopes) | empty states |
| S12 | `/w/:slug/trash` | **Trash**: list with deleted by, deleted on, days left; Restore, Delete for good, Empty trash | retention note; restore conflict; confirm for permanent delete |
| S13 | `/w/:slug/search?q=` and the command palette | **Search**: results with path, match source (name, tag, AI tag, content) and snippet; filters (kind, tags, owner, folder, date) | no result; query too short; AI off note for admins |
| S14 | `/w/:slug/inbox` | Notifications | unread and all; mark read |
| S15 | `/w/:slug/settings` | **Settings** | tabs: General · Members (n) · Teams (n) · Storage · Retention · API keys (n) · Audit; each a read-only card with in-place editing; non-admins see General (read-only) and their own membership only |
| S15a | Settings › Members | members with roles, invitations pending, invite dialog, remove with transfer | last owner refused; step-up on role change |
| S15b | Settings › Teams | teams, members of a team | name taken |
| S15c | Settings › Storage | used, quota, split current / versions / trash, largest files | almost full, full |
| S15d | Settings › Retention | trash days, versions kept, link policy (max days, password required), AI opt-in and budget | saved, refused |
| S15e | Settings › API keys | keys with scopes, origins, last used, app space ("Open folder"); create (secret shown once, snippet for the widget and for `mintAccessToken`); disable, revoke; built on `@softistx/alxia-react-router/api-keys` (0.68: list newest first, one-time secret, step-up replay) | step-up; key limit |
| S15f | Settings › Audit | filterable log (actor, action, target, date), export CSV | empty, large range |
| S16 | `/account/security` | Password, second factor, sessions | read-only with in-place edit |
| S17 | `/s/:token` | **Public link**: password form; a file (preview, Download); a folder (read-only browser); a drop zone (`DROP`) with a per-file list and a "sent" confirmation | one identical "link not available" page for unknown, expired, revoked; locked with wait; no app chrome, no session, `noindex` |
| S18 | resource routes | `/media/*` (proxy), `/s/:token/media/*` (link proxy), `/widget/v1/*` (widget files), `/help/guide.pdf`, `/health` | not screens; in `help:check`'s ignore list |

Each signed-in screen is covered by a flow doc per role and opens from the help button
(`write-flow-docs-and-help`; `help:check` in `verify`). Captures at 360 and 1440 px, light and
dark, are scored on the 12-criteria grid at every round and sent to the owner.

## 5. The widget's two forms

One package, `@softistx/storix-widget`, two entries. Both talk only to `/public/*` with a
scoped token; neither ever holds an API key. Invariants as pulsarix-widget's (loader at most
5 KB gzipped, one global, no `rem` in the built CSS, nothing outside the shadow root,
`credentials: "omit"`, no runtime dependency, shipped `.d.ts`).

### 5.1 `@softistx/storix-widget/source`: a `FileSource` for React apps

```ts
import { createStorixSource } from "@softistx/storix-widget/source";
import { FilePickerDialog } from "@softistx/material/files/picker";

const source = createStorixSource({
  baseUrl: "https://storix.example",          // the storix host
  getToken: () => fetch("/api/storix-token").then((r) => r.json()), // { token, expiresAt }
});
<FilePickerDialog open={open} onOpenChange={setOpen} source={source} kinds={["image"]} onSelect={attach} />
```

- Options: `baseUrl`, `getToken` (called at start and again shortly before `expiresAt`, and
  once after a `tokens.errors.expired`), `locale`, `fetch` (for tests).
- Implements, by the token's mode: `list`, `listFolders`, `getThumbnailUrl`, `getPreviewUrl`
  (blob URLs made from authorised `fetch`es, revoked when evicted), `getUsage`, `listRecent`;
  with `UPLOAD` also `upload` (with progress and `status: 'processing'`) and `createFolder`.
  No `rename`, `move`, `remove`: a scoped token cannot, so material hides those actions.
- Items are `FileSourceItem`s whose `id` is the storix node id; `storixRef(item)` gives
  `{ fileId, versionId, key, name, mimeType, size }`, what the host sends to its server.
- Types only from `@softistx/material-core/files` (an optional peer); no React in this entry.
- A consumer whose pages are served by its own BFF may instead proxy through its server with
  the API key; this entry is for the direct, token-based path.

### 5.2 The script: `loader.js` and `<storix-widget>`

```html
<script src="https://<storix-host>/widget/v1/loader.js" async></script>
<script>
  StorixWidget.init({ getToken: () => fetch("/api/storix-token").then((r) => r.json()) });
  const files = await StorixWidget.pick({ multiple: true, kinds: ["image", "pdf"] });
</script>
```

- **Loader**: an IIFE that defines `window.StorixWidget`, queues calls until the hashed bundle
  (React, material, the source) is loaded, and registers `<storix-widget>` with an open shadow
  root (`PortalContainerProvider`, styles through `adoptedStyleSheets`), as pulsarix-widget.
- **Config** (`init` or data attributes for the static ones): `getToken` (or a static `token`
  for a short-lived page), `apiBase` (defaults to the loader's host), `locale` (`en`, `fr`),
  `theme` (`light`, `dark`, `auto`), `accentColor`, `mode` (`picker` in a dialog, `manager`
  inline in a host element, `dropzone` inline, upload only), `target` (the element for inline
  modes), `kinds`, `multiple`, `upload` (`accept`, `maxSize`).
- **API**: `init(config)`, `pick(options) → Promise<StorixRef[]>` (resolves `[]` on cancel),
  `open()`, `close()`, `mount(target, options)`, `refresh()`, `destroy()`, `on(name, cb)`.
- **Events** (`CustomEvent` on the element, and `on`): `storix:ready`, `storix:open`,
  `storix:close`, `storix:select` (`{ files }`), `storix:upload` (`{ file }`),
  `storix:error` (`{ code }`).
- **npm form of the same**: `import { mount, pick } from "@softistx/storix-widget"`, browser
  only, `apiBase` required.
- **Versioning**: `/widget/v1/` keeps its contract; a breaking change is `/v2/` and a major.
  storix-ui serves the widget's `dist` from `WIDGET_DIST_DIR` (`loader.js` `max-age=300`,
  hashed bundles `immutable`), as pulsarix-ui does.
- **For the integrator**: `script-src` and `connect-src` for the storix host; the origin must
  be in the API key's allowed origins. The README documents both, and the token endpoint.

## 6. Upstream package changes

Each is filed as an issue on the package's repository through `nxgt-issues`
(`report-to-upstream`) during the bootstrap effort, with one agent per issue, before the slice
that needs it. Nothing below is worked around in storix.

| # | Package (repository) | Change | Why | Blocks |
| --- | --- | --- | --- | --- |
| UP-1 | `@softistx/alxia-media` (softistx/alxia) | A kind that accepts any content type (`accept: "*"`): sniff the types with a known signature, store the declared type otherwise, and serve anything outside an inline-safe list as `application/octet-stream` with `attachment` | a file manager stores every type; today `accept` is an exact list and a wildcard throws at declaration | A7 |
| UP-2 | `@softistx/alxia-media` (softistx/alxia) | The declared `Content-Length` and the kind's context available to `authorizeWrite` / `throttle` (or a `quota(ctx, bytes)` hook), so an app refuses on a quota before a byte is read | the quota check must come before the body; to verify first: if `ctx` already carries the request, this is a doc issue | A11 |
| UP-3 | `@softistx/alxia-media` + `@softistx/alxia-react-router/media` (softistx/alxia) | Resumable upload in parts (`POST …/uploads`, `PUT …/uploads/<id>/<n>`, complete, abort), with the BFF proxy's matching routes | files above one request's limit (95 MiB behind the edge proxy) | Next (Q1) |
| UP-4 | `@softistx/s3` | A multipart API (create, upload part, complete, abort, list parts); today "Multipart upload" is under Not planned | UP-3 needs parts that survive between requests | Next (Q1) |
| UP-5 | `@softistx/image` (`/pdf`) | `renderPdfPage(input, { page })` and `extractPdfText(input, { maxBytes })`; today only page 1 is drawn and the text layer is "not planned yet" | full-text search of PDFs, OCR of scanned PDFs | A25, A26 |
| UP-6 | `@softistx/image` (new `/video`) | A poster frame and a probe (duration, width, height) of a video | video thumbnails; v1 ships without | Later |
| UP-7 | `@softistx/material` (softistx/nxgt-material) | `FileSource` trash: `listTrash`, `purge`, `emptyTrash`, and a `trash` scope in `FileManager` (deleted by, days left, Restore, Delete for good) | every app with a trash would rebuild it; today only `remove` / `restore` (undo) exist | U12 |
| UP-8 | `@softistx/material` | `FileSource` versions: `listVersions`, `restoreVersion`, `removeVersion`, `uploadVersion`; a Versions section in the details; an upload name-conflict dialog (new version, keep both, skip) | reusable; today a same-name upload has no path | U11 |
| UP-9 | `@softistx/material` | `ShareDialog`: people and teams search with a role select, a links section (mode, expiry, password, copy, revoke), fed by callbacks | a reusable part, never written in an application | U13, U16 |
| UP-10 | `@softistx/material` | Whole-library search in `FileManager` and the picker: `source.search(query, options)` with each hit's path, match source and snippet (today the filter bar searches the open folder only); item badges for "shared" and the owner | search results inside the manager, the picker and the widget | U19, W2 |
| UP-11 | `@softistx/ai-core`, `@softistx/ai-anthropic` (softistx/nxgt-ai) | A `document` (PDF) message part | sends a scanned PDF to the model whole, instead of page images; optional, UP-5 covers v1 | none |

To verify in a spike before filing (may add an issue): `FileManager` and `FilePickerDialog`
inside a shadow root (`files.css` adoptable, portals, pointer drag and drop, the marquee) on
material's Shadow DOM guide; `mediaRoutes` mounted a second time under `/public/media` behind
a middleware that adds CORS headers (browsers apply `Cross-Origin-Resource-Policy` to no-cors
loads only, so the widget's CORS `fetch` passes); `proxyMediaRead` / `proxyMediaWrite` mounted
a second time with the link grant as its token.

## 7. Efforts and slices

Every slice is one issue in its repository, one agent, one PR into its effort's integration
branch `feat/<slug>` (the same slug in each repository involved), with the four gates of
"Merges and releases". Acceptance always includes `bun run verify` green and the specs named;
UI slices also include the changed screens captured at 360 and 1440 px, light and dark, scored
at least 4 on every criterion of the design grid, shown to the owner, plus the Playwright
quality spec of the screen (Chromium, local) and its flow doc. Browser tests never run in CI.
`A` = storix-api, `U` = storix-ui, `W` = storix-widget, `X` = across.

### E0. Bootstrap (no integration branch: the skeleton is each repository's first commit)

Coordination first (the coordinating session, not a slice): `~/workspace/dev/storix/AGENTS.md`
after pulsarix's, `docs/roadmap.md` (§8), the three repositories created on GitHub (private,
`develop` default, `main` following), one issue per slice below, the tracking issue on
storix-api, the upstream issues UP-1 to UP-11 filed with an agent each. While the organisation's
workflows are disabled, a new repository's `ci.yml` is disabled at creation
(`gh workflow disable`) and the local green bar is the proof.

| # | Slice | Delivers | Acceptance | Depends on |
| --- | --- | --- | --- | --- |
| A0 | `chore: initial skeleton` | Bun, alxia, graxia, `config/env.ts`, `core/` and `modules/registry.ts`, health, `schema.graphql` printed, docker-compose (MongoDB replica set, Redis, Mailpit, SeaweedFS), `scripts/dev.ts`, `verify` and `verify:pr` (affected specs), `ci.yml` (one job, `pull_request` into `develop`), `AGENTS.md`, `CONTEXT.md`, `README.md`, `docs/roadmap.md`, `docs/development.md`, `.nxgt-issues.json`, Dockerfile and `.dockerignore`, the janus-import dependency check | `verify` green; `bun run dev` answers `/health`; `bun check` reports a seeded error then a clean tree | none |
| A1 | `feat(i18n): error inventory, translations and errorCatalogue` | `defineCodes`, `fail`, `ErrorCode`, the `translations` collection and its first migration (auth, validation), `Query.errorCatalogue`, `coverage.spec.ts`, `db:migrate`, `db:sync` | a code without a message in both languages fails the spec; the catalogue's `version` changes with a text | A0 |
| U0 | `chore: initial skeleton` | React Router 8 on `@softistx/alxia-react-router`, `execute()` and the proxy secret, material, `app/themes/storix.ts` (generated CSS committed), i18n English and French, `AppShell` with the six destinations as empty pages, CSP and security headers, the mock API (`app/mocks`), `check:i18n`, `check:deps`, `check:theme`, `build:checked`, Playwright quality harness, `ci.yml`, `AGENTS.md`, `README.md`, `docs/roadmap.md`, `docs/security.md` | `verify` green; the shell captured and scored; no sideways scroll at 360 px | none |
| U1 | `feat(landing): public landing page, privacy and terms` | S1, S2: `app/modules/landing`, `app/modules/legal`; a guest sees the landing page at `/`, a signed-in visitor is sent on; meta, Open Graph, sitemap, `robots.txt` | captures of S1 and S2 scored; the page is indexable and the app pages are not; axe clean | U0 |
| U2 | `feat(help): help panel and flow-doc harness` | `HelpButton` and `HelpSheet` in the shell, `docs/flows/` layout, `capture()`, `help:check` in `verify`, the role guide route | a screen route cited by no flow fails `help:check` | U0 |
| W0 | `chore: initial skeleton` | the build (loader IIFE, hashed bundle, ESM entry, `./source` entry, `.d.ts`), `<storix-widget>` with an open shadow root and material's styles inside, `check-size`, the host fixture and leak test, `capture` script, `ci.yml`, `AGENTS.md` (the invariants of §5), `README.md`, `docs/roadmap.md`; the shadow-root spike of §6 with `FilePickerDialog` over `createMemorySource` | `verify` green; loader at most 5 KB gzipped; the leak test shows no style either way and one global; captures of the picker in the fixture | none |

### E1. Identity and workspaces: `feat/workspaces`

| # | Slice | Delivers | Acceptance | Depends on |
| --- | --- | --- | --- | --- |
| A2 | `feat(identity): accounts behind the identity port` | the `Identity` port and the janus adapter; sign-up, sign-in, sign-out, reset, e-mail verification, TOTP, step-up; `viewer` (with `apiKeyId`); janus's key store wired (`createMongoApiKeys`) and `authenticate(request, { apiKey: true })`; the key-paths middleware (401 `auth.errors.api-key-not-accepted` off `/graphql`, `/media`, `/health`, `/ready`); the mails through `@softistx/janus-mail` | specs for each flow and its refusals; the dependency check refuses a janus import outside the seam; a key-shaped bearer on any other path is the 401 code | A1 |
| A3 | `feat(workspaces): workspaces, members and roles` | `workspaces`, a database per workspace, `members`, roles and permissions, guards, the tenant header, `createWorkspace`, role changes behind step-up, last-owner rule | isolation spec: a member of one workspace reads nothing of another; role matrix spec | A2 |
| A4 | `feat(invitations): invite members by e-mail` | invitations with a hashed token, accept, revoke, throttled mail | invite to accept to member; expired and reused tokens refused | A3 |
| A5 | `feat(teams): teams of members` | `teams` CRUD and membership | name unique ignoring case; a removed member leaves their teams | A3 |
| A6 | `feat(audit): append-only audit log` | `auditEvents`, the `audit.record` port every module calls after commit, `auditEvents` query for admins, the address hash | events for the E1 writes; a member is refused the query; no secret in any event (spec scans) | A3 |
| U3 | `feat(session): sign-in, sign-up and account security` | S3, S16 on `app/core/session`; cookies, `requireViewer`, the second-factor step | captures scored; refusals worded from the catalogue; focus on the first invalid field | U0, A2 |
| U4 | `feat(workspaces): picker, creation and the workspace shell` | S5; `/w/:slug` layout with the switcher and the viewer's role | captures scored; an unknown slug is the not-found page | U3, A3 |
| U5 | `feat(settings): general, members and teams` | S15 (General, Members, Teams tabs), S4; read-only cards edited in place, invite dialog, remove with transfer | captures scored; unsaved-changes guard; step-up on a role change | U4, A4, A5 |

### E2. Files: `feat/files`

| # | Slice | Delivers | Acceptance | Depends on |
| --- | --- | --- | --- | --- |
| A7 | `feat(storage): bucket, kinds and the media routes` | `storage.bucket.ts`, the `files` and `avatars` kinds, `/media` mounted after the auth middleware with `keyPrefix`, the upload rate limit, refusals in the GraphQL error shape | specs through the real routes on SeaweedFS: `Range`, `ETag`, 304, 416, type, size, empty, throttle, another workspace's key is a 404 | A3, UP-1 |
| A8 | `feat(nodes): the folder tree` | `nodes` (folders), `createFolder`, `renameNode`, `moveNodes` for folders, `ancestors`, depth, cycle and name rules, `folders`, `nodePath`, `roots`, the member's root made at joining | concurrency spec (two creates of one name; a move against a rename); cycle and depth refused | A3 |
| A9 | `feat(files): record an upload and list a folder` | `blobs`, `addFile` with `onConflict` `REFUSE` and `KEEP_BOTH`, `node`, `nodes` (filter by family, tags, name; sort by name, date, size, kind; cursor), `authorizeRead` by key | a key of another workspace, kind or already recorded is `files.errors.key-unknown`; cursors stable under each sort | A7, A8 |
| A10 | `feat(files): rename, move, copy, tags and metadata` | `renameNode` for files, `moveNodes`, `copyNodes` (shared blob), `updateFile`, `tags`; bulk of at most 100, all or nothing | a copy adds no object to the bucket; a failed bulk moves nothing | A9 |
| A11 | `feat(quotas): usage counters and the quota` | `workspaces.usage`, the check in the `PUT` and in `addFile`, `storage`, the reconcile job, `workspace:quota` script | an upload over the quota is refused before the body and leaves no object; counters equal a recount after a mixed run | A9, UP-2 |
| A12 | `feat(renditions): thumbnails and previews by the worker` | `src/worker.ts`, the queues, `thumb` and `preview` for images and PDF page 1, `status`, retry and failure | a picture is `PROCESSING` then `READY` with both sizes served; a corrupt one is `FAILED` and still downloadable | A9 |
| A13 | `feat(renditions): focal point and crops` | `setFocalPoint`, the four crop presets redone by the worker from the stored original, `File.renditions`, `rendition(preset)` | crops centre on the point; the `ETag` of a crop changes after a move of the point | A12 |
| A14 | `feat(files): favourites and recents` | `stars`, `recents` (recorded on open and upload, capped), `starred`, `recentFiles`, `setStarred` | per-account isolation; a trashed or unshared node leaves both lists | A9 |
| A15 | `feat(storage): orphan sweep` | the `sweep` job and script: released blobs, unrecorded objects older than 75 minutes, renditions with them | a recorded object is never swept (race spec, ported from `media.race.spec.ts`) | A10 |
| U6 | `feat(media): the media route and the storix file source` | `/media/*` on `proxyMediaRead` / `proxyMediaWrite`; `app/modules/files`: source client, registry, upload with progress and processing check, the `FileSource` (ported from publix-ui's `file-source.ts`) | unit tests of every source method on the mock API; a 413 over the kind's limit before the API is called | U4, A9 |
| U7 | `feat(files): my files` | S6 with `FileManager`: path in the URL, uploads, bulk rename, move, copy, drag to a folder, tags, the storage footer | captures of empty, loaded (grid and list), uploading, refused, phone; keyboard-only upload and move | U6, A10, A11 |
| U8 | `feat(files): the file page and the viewers` | S7 (Overview tab), S8 with `FileViewersProvider` (PDF reader with its assets, players, gallery, code) | captures per family; read-only for a viewer; processing and failed states | U7, A12 |
| U9 | `feat(files): focal point and crops` | the focal point dialog and the crops preview on S7 (ported from publix-ui) | captures; a moved point shows new crops without a reload | U8, A13 |
| U10 | `feat(files): recent, favourites and storage` | S11, the Storage tab (S15c) | captures; a favourite toggles at once and rolls back on refusal | U7, A14, A11 |

### E3. Versions and trash: `feat/versions-trash`

| # | Slice | Delivers | Acceptance | Depends on |
| --- | --- | --- | --- | --- |
| A16 | `feat(versions): versions of a file` | `versions`, `addFile` with `NEW_VERSION`, `addFileVersion`, `restoreFileVersion`, `deleteFileVersion`, version retention in the `retention` job, a version's key readable by `authorizeRead` | numbers gap-free under concurrency; the current version is never deleted; a restore adds no object | A10 |
| A17 | `feat(trash): trash, restore and purge` | `trashNodes`, `restoreNodes`, `purgeNodes`, `emptyTrash`, `trash`, subtree cascade, trash retention, settings fields | a trashed subtree leaves every list and read; restore conflict handled; purge releases blobs and the quota | A10, A11 |
| U11 | `feat(versions): the versions tab` | S7 Versions tab, "Upload new version", the name-conflict dialog on S6 | captures; restore with an undo toast | U8, A16, UP-8 |
| U12 | `feat(trash): the trash and retention settings` | S12, delete with undo on S6, the Retention tab (S15d) | captures of empty, loaded, confirm; keyboard path | U7, A17, UP-7 |

### E4. Sharing: `feat/sharing`

| # | Slice | Delivers | Acceptance | Depends on |
| --- | --- | --- | --- | --- |
| A18 | `feat(shares): grants and the effective role` | `grants`, `shareNode`, `changeGrant`, `unshareNode`, `access.roleOn` used by every node, version, trash and media guard, `Node.myRole` | a role matrix spec over owner, editor, viewer, team member, stranger for every operation and `/media` read; a revoked grant is a 404 on the next read | A17, A5 |
| A19 | `feat(shares): shared with me, shared by me, ownership transfer` | `sharedWithMe`, `sharedByMe`, a removed member's root transferred, their grants and links ended | lists show the topmost shared node only; transfer keeps every blob | A18 |
| A20 | `feat(notifications): inbox and mails of sharing` | `notifications`, the inbox queries, mails through the queue (shared with you, role changed, quota thresholds), per-account mail preference | one notification and one mail per share to a team member; no mail to oneself | A18 |
| U13 | `feat(shares): the share dialog and the sharing tab` | S9 (people and teams), S7 Sharing tab, the "shared" badge in lists | captures; a viewer sees no Share; role change rolls back on refusal | U8, A18, UP-9 |
| U14 | `feat(shares): the shared screen` | S10 (With me, By me) | captures per tab, empty states | U13, A19 |
| U15 | `feat(notifications): the inbox` | S14, the bell with its unread count | captures; mark read; a notification opens its file | U4, A20 |

### E5. Share links: `feat/links`

| # | Slice | Delivers | Acceptance | Depends on |
| --- | --- | --- | --- | --- |
| A21 | `feat(links): create, list and revoke share links` | `links`, `linkIndex`, hashed tokens, expiry and policy, `createShareLink`, `updateShareLink`, `reissueShareLink`, `revokeShareLink`, `Node.links`, `shareLinks` | the token is in one answer only and in no log, event or database (spec scans the stores); policy refusals | A18 |
| A22 | `feat(links): the visitor side` | `shareLink`, `openShareLink`, link grants in Redis, `linkNodes`, media read by grant, the rate limits and the lock, `maxDownloads` | unknown, expired, revoked and trashed answer byte-identical 404s; the lock after 5 wrong passwords; a grant dies with the password | A21 |
| A23 | `feat(links): drop links` | `DROP` mode: upload by grant, `addDroppedFile`, caps, the owner's notification | a drop visitor lists nothing; caps and quota refused without the quota figure | A22, A20 |
| U16 | `feat(links): links in the share dialog and the links tab` | S9 links section, S10 Links tab | captures; the link is copyable once, then shown by its hint | U13, A21 |
| U17 | `feat(links): the public link page` | S17 for `VIEW` (password, file, folder), `/s/:token/media/*` | captures of every state; no app chrome, `noindex`, `no-referrer`; one page for every unavailable case | U8, A22 |
| U18 | `feat(links): the public drop page` | S17 for `DROP` | captures of idle, sending, sent, refused; keyboard and touch upload | U17, A23 |

### E6. Search and AI: `feat/search`

| # | Slice | Delivers | Acceptance | Depends on |
| --- | --- | --- | --- | --- |
| A24 | `feat(search): the search index and query` | `searchDocs` kept with the node in its transaction, the text index, `search` with the caller's scope and filters, match source and snippet | a stranger's file never appears (matrix spec); ranking: name over tag over content | A18 |
| A25 | `feat(extraction): text of text files and PDFs` | the `extraction` job: text and code as they are, a PDF's text layer, the 200 KB cap | a word inside a PDF finds the file; a failed extraction leaves the name searchable | A24, A12, UP-5 |
| A26 | `feat(ai): AI tags and OCR` | the `ai` job on `@softistx/ai-core` structured output, adapters from env, the opt-in setting and monthly budget, usage through `@softistx/ai-telemetry`, the paced backfill | specs on `fakeModel`: tags and text stored, a hostile model output stays inert, the budget stops the job; nothing is sent while the setting is off | A25 |
| U19 | `feat(search): the search page and the command palette` | S13, `Cmd+K` palette (files, folders, actions) | captures; keyboard-only search to open; filters in the URL | U7, A24, UP-10 |
| U20 | `feat(ai): AI settings and tags` | the AI card of the Retention tab (opt-in, budget, usage), AI tags on S7 told apart from the user's | captures; the opt-in states what is sent and to whom | U19, A26 |

### E7. Consumers and the widget: `feat/consumers`

| # | Slice | Delivers | Acceptance | Depends on |
| --- | --- | --- | --- | --- |
| A27 | `feat(api-keys): bind janus API keys to workspaces` | the thin `api-keys` module: `apiKeyBindings`, create (janus key + binding, behind step-up), update, disable, revoke, the `API_KEY` principal from `viewer.apiKeyId`, scopes on operations, the app-space root, the owner-leaves rule; no home-made key store | scope matrix spec; a key outside its space is a 404; a key without a binding or of another workspace is 401; the secret is in one answer only and in no store of storix; a key on `/public` is `auth.errors.api-key-not-accepted` | A2, A18 |
| A28 | `feat(tokens): scoped tokens` | `mintAccessToken`, `revokeAccessToken`, the Redis store, the key cascade, fail closed | a token outside its folder, mode, origin or lifetime is refused with its own code; revoking the key ends its tokens | A27 |
| A29 | `feat(public): the public surface for the widget` | `/public/graphql` (persisted operations only), `/public/media`, CORS for the key's origins, the preflight, per-token limits | a foreign origin gets no CORS header; an ad-hoc query is `public.errors.persisted-only`; `UPLOAD` uploads and `READ` cannot | A28, A24 |
| A30 | `feat(usages): where a file is used` | `usages`, `setFileUsage`, `removeFileUsage`, `File.usages`, `usageCount`, the in-use rule on trash | ported `media.usage.spec.ts` cases; `force` trashes a used file | A27 |
| U21 | `feat(api-keys): the API keys tab` | S15e with the snippets, "Open folder" on an app space; the routes on `@softistx/alxia-react-router/api-keys` (0.68) | captures; the token is shown once; step-up | U5, A27 |
| U22 | `feat(audit): the audit tab` | S15f | captures; filters in the URL; CSV export | U5, A6 |
| U23 | `feat(widget): serve the widget files` | `/widget/v1/*` from `WIDGET_DIST_DIR` | traversal specs; cache headers; 404 when unset in production | U0, W0 |
| W1 | `feat(source): the storix file source` | `createStorixSource` (§5.1), token refresh, blob-URL cache, `storixRef` | unit tests against a stub of `/public`; an expired token is renewed once, then surfaces `tokens.errors.expired` | W0, A29 |
| W2 | `feat(widget): the picker` | `pick()`, config, events, locales, theme seed; `FilePickerDialog` in the shadow root | host-fixture test picks a file; captures at 360 and 1440, light and dark; the leak test stays green | W1, UP-10 |
| W3 | `feat(widget): the inline manager and the drop zone` | `mount()` in `manager` and `dropzone` modes with uploads | upload in the fixture ends with `storix:upload`; refusals worded | W2 |
| W4 | `docs(widget): integration guide` | README (script, npm, `/source`, the token endpoint, CSP), `docs/troubleshooting.md` | the documentation-auditor reports ok | W3 |

### E8. Release (one PR each, no integration branch)

| # | Slice | Delivers | Acceptance | Depends on |
| --- | --- | --- | --- | --- |
| A31 | `feat(deploy): the deploy stack` | `deploy/` after pulsarix-api's: compose (api, worker, ui, MongoDB, Redis, SeaweedFS or the hosted S3), `db:sync` at deploy, backups, restore drill, the runbook; `/public` routed on the storix host | `bun test ./deploy/` green; a dry deploy on staging | E7 |
| U24 | `build(ui): the production image` | the Dockerfile, the widget `dist` mounted read-only, `assertEnv` | the image starts under `NODE_ENV=production` and refuses a missing proxy secret | U23 |
| X1 | `test: end-to-end on the real stack, and v1` | `bun run e2e:stack` in storix-ui (a host page, the widget, a pick and an upload, a share link opened, a drop received) on Docker services; the feature sheets (`docs/fonctionnalites/`) and flow docs complete; `@softistx/storix-widget` 0.1.0 published; the roadmap entries moved to Shipped | the stack run green on a quiet machine (a heavy job, announced); each version checked on the registry | all |

Slice counts: storix-api 32 (A0 to A31), storix-ui 25 (U0 to U24), storix-widget 5 (W0 to W4),
1 across. Efforts run in the order E0 to E8; E3, E4 and E6 can overlap once E2 has landed, E7
needs E4 and A24.

## 8. Roadmap entries

Written into each repository's `docs/roadmap.md` (and the coordinating folder's) by the
`roadmap-keeper`, phrased as what a user gets; an entry moves Next → Now → Shipped as its
effort starts and lands in `develop`.

**storix-api**

- Now: *Accounts and workspaces*: sign in, create a workspace, invite members, group them in
  teams, with every change in an audit log.
- Next: *Files and folders*: upload, organise, tag, copy and move files, with thumbnails,
  previews, image crops around a focal point and a storage quota. *Versions and trash*: keep
  earlier versions of a file and get deleted files back for 30 days. *Sharing*: share a file or
  a folder with people and teams as viewer or editor, and be notified. *Share links*: a link
  with an expiry and a password, to download or to receive files. *Search*: find a file by its
  name, its content, its tags, or what an AI reads in it. *For integrators*: an API key per
  workspace, short-lived scoped tokens, and where each file is used.
- Later: files larger than one request (resumable upload); office documents previewed as PDF;
  video posters; custom crop presets; webhooks; live updates; moving very large folders.
- Not planned: desktop sync, billing, offline mode, collaborative editing.

**storix-ui**

- Now: *Sign-in and workspaces*, and a public landing page.
- Next: *My files* (browse, upload, preview PDF, video, audio, images and code); *file page*
  with versions, sharing, usage and activity; *trash*; *shared with me and by me*; *public
  link pages* to download or drop files; *search* and a command palette; *settings* for
  members, teams, storage, retention, API keys and the audit log; help on every screen.
- Later: resumable uploads with pause and resume; office previews; bulk download as a zip;
  installable app (PWA).
- Not planned: offline mode, collaborative editing.

**storix-widget**

- Now: nothing shipped yet; the package skeleton.
- Next: *A file picker for any page*: one script tag opens a storix folder in a dialog and
  returns the chosen files. *For React apps*: a storix source for `FilePickerDialog`,
  `FilePickerField` and `FileManager`. *An inline manager and a drop zone* with uploads.
- Later: search inside the picker, image crop on pick, a Vue wrapper.
- Not planned: a widget that works without the consumer's server minting tokens.

## 9. Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Upstream waits (UP-1, UP-2, UP-5, UP-7 to UP-10; UP-3, UP-4, UP-6 do not block v1) | slices A7, A11, A25, U11 to U13, U19 start late | file every issue in E0 with an agent each; the order above puts independent slices first; a UI slice that waits on a material component does its API wiring and tests on the mock meanwhile |
| `FileManager` inside a shadow root | the widget's core assumption | the spike is part of W0, before any other widget slice |
| MongoDB `$text` quality (one language per document, no fuzzy match, no prefix) | search feels weaker than expected, mostly in French | store `language` per document from the workspace's language and the AI's detection; keep the name substring path; a search engine is a Later decision, behind the `search` service |
| Permission filtering in lists and search | slow listings for a member with many grants | grants resolved once per request (DataLoader), `ancestors` indexed; a spec with 5,000 nodes and 200 grants has a time budget |
| Folder move rewriting `ancestors` | long transactions | the 5,000-node cap in v1, batched moves in Later |
| A reader who lost access keeps a cached file | stale access | `private, no-cache` on the kind; documented cost: one revalidation per use |
| AI cost and privacy | bills, content leaving the server | opt-in per workspace, monthly budget, size caps, Ollama option, usage shown to admins |
| Single-request upload limit behind the edge proxy | large files refused | Q1; the limit is worded in the UI before the upload starts |
| Redis loss | scoped tokens, link grants and limits vanish | fail closed for tokens and uploads; visitors re-enter a password; nothing durable lives in Redis |
| SeaweedFS locally, another S3 in production | behaviour differences | the storage specs run on SeaweedFS; the deploy slice runs the same spec file against the production endpoint once |
| Three new repositories while workflows are disabled organisation-wide | no CI proof | local green bar per PR, stated in the PR; workflows enabled only on the owner's yes |

## 10. Decided

The owner's answers, 2026-11-13 (about 13:10 EST). All followed the recommendation except Q4.

- **Q1. Largest file in v1**: 95 MiB per file; resumable upload (UP-3, UP-4) is the first effort
  after v1. The two upstream issues are filed now, labelled not blocking v1.
- **Q2. Who sees what by default**: a private root per member plus explicit sharing; app spaces
  for API keys.
- **Q3. AI tags and OCR**: off by default, opt-in per workspace by an admin with the provider
  named, a monthly budget, Ollama for a self-hosted stack.
- **Q4. Workspace API keys (differs from the recommendation)**: as in self-learning, no
  home-made key store. janus's built-in keys (`createMongoApiKeys` from `@softistx/janus-mongo`,
  `auth.accounts.authenticate(request, { apiKey: true })`, the viewer carries `apiKeyId`), plus a
  thin storix `api-keys` GraphQL module that ties each key to a storix workspace and its
  scopes, and a 401 `auth.errors.api-key-not-accepted` on every path a key may not reach (§3.7).
  Reference, read-only: self-learning-api `src/app.ts`, `src/auth/viewer.ts`, `src/auth/auth.ts`,
  `src/modules/api-keys`. The UI tab uses `@softistx/alxia-react-router/api-keys` (0.68).
- **Q5. Registry of `@softistx/storix-widget`**: GitHub Packages, restricted, published locally
  after the green bar.
- **Q6. Share-link expiry**: required, 7 days by default, at most 365, with a workspace policy
  that can require a password.
- **Q7. Videos and office documents in v1**: videos play (streamed) with their family icon as
  thumbnail until UP-6; office documents get a download card; both improve in Later.
- **Q8. Default quota**: 10 GiB per workspace, changed by a platform script.
- **Q9. Versions and trash count against the quota**: yes, shown as a split, shared blobs once.
- **Q10. Host names**: decided at the deploy slice (A31), `storix.softistx.com` for staging first.

### Packages released after the plan was written

- `@softistx/alxia` 0.23 adds `requireProxySecret({ paths, secret, errorFormat })`. It fits a path
  that only the BFF reaches. `/graphql` and `/media` are also reached by keys, so the viewer,
  not the secret, decides there; A0 checks whether the account routes or any other path are
  BFF-only before wiring it.
- `@softistx/alxia-react-router` 0.68 adds `/api-keys` (U21) and the link-redirect helpers `handOver`,
  `handingOver`, `postLinkRequest`, `postLinkArgs` on `/session`. They fit the e-mailed links
  of U3 (reset, verification) and the invitation accept of U5, not share links, which are
  storix's own `/s/<token>` pages.

## 11. Later: publix moves its media library onto storix

A separate effort after storix v1 is validated, planned by the publix coordinating session
with its own issues and roadmap entries; nothing here is a v1 slice. Outline:

1. **Fit check**: map publix's media features to storix: folders and files (`nodes`), tags,
   the five renditions and the focal point (same presets, by design), usage tracking
   (`usages` with `app: "publix"`), storage figures, the upload rate limit, streamed reads.
   Gaps found become storix issues first.
2. **Provisioning**: one storix workspace per publix workspace (or one app space per publix
   workspace inside a shared storix workspace: a decision of that effort), an API key with
   `files:read`, `files:write`, `tokens:mint`, `usages:write`, kept in publix-api's env.
3. **publix-api**: the `media` module becomes a thin client of storix (`/graphql` and `/media`
   with the API key); `Media.key` keeps its meaning for content snapshots; `usedBy` writes
   `setFileUsage`; the module's storage, renditions and sweep code is deleted.
4. **publix-ui**: `app/modules/media/file-source.ts` is replaced by `createStorixSource`
   (tokens minted by publix-api) or by its BFF proxying with the key; the focal point dialog
   and the library screens stay on material.
5. **Data migration**: a script that walks each publix workspace, streams every object to
   storix (`PUT` then `addFile`, keeping names, folders, tags, focal points and dates),
   records the old-key to new-file map, rewrites the keys held by contents and snapshots, and
   verifies counts and bytes. It runs per workspace, is resumable and idempotent; the old
   bucket is kept read-only until the owner says to delete it (deleting data waits for the
   owner's explicit yes).
6. **Cut-over**: a flag per workspace (old library, then storix), the full pass, then the
   removal of the old module and bucket.

The same path then serves pulsarix's attachments and any other product's files.

## Tracking

Effort issues (each lists its slices; slice issues are linked from them). Upstream issues UP-1 to UP-11 are tracked privately as softistx/storix-api#1 to #11.

**storix-api**

- E0: https://github.com/softistx/storix-api/issues/12
- E1: https://github.com/softistx/storix-api/issues/13
- E2: https://github.com/softistx/storix-api/issues/14
- E3: https://github.com/softistx/storix-api/issues/15
- E4: https://github.com/softistx/storix-api/issues/16
- E5: https://github.com/softistx/storix-api/issues/17
- E6: https://github.com/softistx/storix-api/issues/18
- E7: https://github.com/softistx/storix-api/issues/19
- E8: https://github.com/softistx/storix-api/issues/20

**storix-ui**

- E0: https://github.com/softistx/storix-ui/issues/1
- E1: https://github.com/softistx/storix-ui/issues/2
- E2: https://github.com/softistx/storix-ui/issues/3
- E3: https://github.com/softistx/storix-ui/issues/4
- E4: https://github.com/softistx/storix-ui/issues/5
- E5: https://github.com/softistx/storix-ui/issues/6
- E6: https://github.com/softistx/storix-ui/issues/7
- E7: https://github.com/softistx/storix-ui/issues/8
- E8: https://github.com/softistx/storix-ui/issues/9

**storix-widget**

- E0: https://github.com/softistx/storix-widget/issues/1
- E7: https://github.com/softistx/storix-widget/issues/2

**Upstream** (tracking issue in storix-api has the same number as UP-n)

- UP-1: softistx/alxia#756
- UP-2: softistx/alxia#757
- UP-3: softistx/alxia#758 (not blocking v1)
- UP-4: softistx/nxgt-data#403 (not blocking v1)
- UP-5: softistx/nxgt-data#404
- UP-6: softistx/nxgt-data#405 (not blocking v1)
- UP-7: softistx/nxgt-material#4714
- UP-8: softistx/nxgt-material#4715
- UP-9: softistx/nxgt-material#4716
- UP-10: softistx/nxgt-material#4717
- UP-11: softistx/nxgt-ai#154 (optional)
