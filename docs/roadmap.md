# Roadmap: storix-api

What a user gets, in order. An entry moves Next, Now, Shipped as its effort starts and lands in `develop`.

## Now

## Next

- **E5 Share links**: a link with an expiry and a password, to download or to receive files. ([issue](https://github.com/softistx/storix-api/issues/17))
- **E6 Search**: find a file by its name, its content, its tags, or what an AI reads in it (AI is opt-in per workspace). ([issue](https://github.com/softistx/storix-api/issues/18))
- **E7 For integrators**: an API key per workspace (built on the identity provider's keys), short-lived scoped tokens for the widget, and where each file is used. ([issue](https://github.com/softistx/storix-api/issues/19))
- **E8 Release**: a deploy stack, an end-to-end run on the real stack, and v1. ([issue](https://github.com/softistx/storix-api/issues/20))

## Later

- Files larger than one request (resumable upload).
- Office documents previewed as PDF; video posters and thumbnails.
- Animated images and audio waveforms as previews.
- Custom crop presets; webhooks; live updates; moving very large folders.

## Not planned

- Desktop sync, billing, offline mode, collaborative editing.
- Office-document conversion and video transcoding in v1.

## Shipped

- **E4 Sharing**: share a file or a folder with people and teams as viewer or editor, with effective roles worked out for each member, a shared-with-me list and a shared-by-me list, and notifications when something is shared. ([issue](https://github.com/softistx/storix-api/issues/16))
- **Conventions alignment**: the code laid out by role in every module, batched field reads (no per-row queries on file versions or workspace settings), shorter functions and stricter lint guards, with no change to the API's behaviour. ([issue](https://github.com/softistx/storix-api/issues/158))
- **E3 Versions and trash**: earlier versions of a file are kept (the newest 20, or 90 days) and can be listed, restored as a new version and deleted. Deleted files and folders go to a trash for 30 days, from which they can be restored (with a "name (1)" suffix if the name is taken), purged, or the trash emptied. Admins manage the workspace's trash, and the trash counts toward the quota. ([issue](https://github.com/softistx/storix-api/issues/15))
- **E2 Files and folders**: each member has a private "My files", with nested folders that can be created, renamed and moved (up to 16 levels deep), uploaded files recorded in them (two on a name keep both, or refuse), files and folders copied (a copy of a file adds no stored object), files tagged and given free metadata, and a folder listed by type, tag and name, sorted by name, date, size or kind. Moves, copies and the like take up to 100 items at once and apply all or nothing. A workspace has a storage quota (10 GiB by default) that refuses an upload before it is read, and a `storage` query shows what is used. Files can be starred as favourites, and the files a member uploaded or opened lately are listed (200 kept). Pictures (JPEG, PNG, WebP) and PDFs get a 320 px thumbnail and a 1600 px preview made in the background by a worker, `PROCESSING` until ready; a corrupt picture ends `FAILED` and stays downloadable. A picture also gets four crops (square, portrait, story, landscape) centred on a focal point that can be moved, the worker redoing the crops each time. Storage nothing references (released files, uploads never recorded after 75 minutes) is cleaned up by an hourly sweep. ([issue](https://github.com/softistx/storix-api/issues/14))
- **E1 Accounts and workspaces**: sign in, create a workspace with its own isolated database, invite members by e-mail, group them in teams, give them owner, admin or member permissions, and read every change in an audit log. ([issue](https://github.com/softistx/storix-api/issues/13))
- **E0 Bootstrap**: a running API skeleton with health, the verify script, and an error catalogue whose codes and messages, in English and French, any client can read. ([issue](https://github.com/softistx/storix-api/issues/12))
