# Roadmap: storix-api

What a user gets, in order. An entry moves Next, Now, Shipped as its effort starts and lands in `develop`.

## Now

- **E1 Accounts and workspaces**: sign in, create a workspace, invite members, group them in teams, with every change in an audit log. ([issue](https://github.com/softistx/storix-api/issues/13))

## Next

- **E2 Files and folders**: upload, organise, tag, copy and move files, with thumbnails, previews, image crops around a focal point and a storage quota. ([issue](https://github.com/softistx/storix-api/issues/14))
- **E3 Versions and trash**: keep earlier versions of a file and get deleted files back for 30 days. ([issue](https://github.com/softistx/storix-api/issues/15))
- **E4 Sharing**: share a file or a folder with people and teams as viewer or editor, and be notified. ([issue](https://github.com/softistx/storix-api/issues/16))
- **E5 Share links**: a link with an expiry and a password, to download or to receive files. ([issue](https://github.com/softistx/storix-api/issues/17))
- **E6 Search**: find a file by its name, its content, its tags, or what an AI reads in it (AI is opt-in per workspace). ([issue](https://github.com/softistx/storix-api/issues/18))
- **E7 For integrators**: an API key per workspace (built on the identity provider's keys), short-lived scoped tokens for the widget, and where each file is used. ([issue](https://github.com/softistx/storix-api/issues/19))
- **E8 Release**: a deploy stack, an end-to-end run on the real stack, and v1. ([issue](https://github.com/softistx/storix-api/issues/20))

## Later

- Files larger than one request (resumable upload).
- Office documents previewed as PDF; video posters and thumbnails.
- Custom crop presets; webhooks; live updates; moving very large folders.

## Not planned

- Desktop sync, billing, offline mode, collaborative editing.
- Office-document conversion and video transcoding in v1.

## Shipped

- **E0 Bootstrap**: a running API skeleton with health, the verify script, and an error catalogue whose codes and messages, in English and French, any client can read. ([issue](https://github.com/softistx/storix-api/issues/12))
