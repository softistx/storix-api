# Troubleshooting

Each heading is the exact message. The boot rule behind them is in [development.md](development.md#boot-and-deploy).

## `N migration(s) pending: run bun run db:migrate`

The server stops at startup with `MigrationsOutOfSyncError`.

**When:** in production (outside production the server migrates itself), when the build lists migrations the database has not applied, usually because the new version was rolled out before the data step.

**Why:** the new code reads texts and indexes those migrations write, and every instance racing to migrate at boot is unsafe, so production refuses.

**Fix:** run the data step, then start the server again.

```sh
bun run db:migrate --status   # the pending ids
bun run db:migrate
```

## `N migration(s) recorded but not in this build: <ids>`

A warning on the console. The server does start.

**When:** the database has migrations a newer build ran, and this build does not list them: an old instance restarting during a rollout, or a code rollback after `db:migrate`.

**Why:** the server must come up in both cases, so it only warns. The newer texts stay in the database, and this build serves the codes it knows.

**Fix:** none for a rollout in progress. After a code rollback, undo the newer migrations once the old build runs, or deploy the newer build again.

```sh
bun run db:migrate --status
bun run db:migrate --rollback-to <last id this build lists>
```

## `--rollback-to needs an id`

`bun run db:migrate --rollback-to` was given no id.

**Fix:** pass the id of the migration to keep; everything after it is undone. `--status` lists the ids.

```sh
bun run db:migrate --status
bun run db:migrate --rollback-to 2026-11-13-auth-validation-errors
```

## `translations: no fallback-language text for <code> (en), ...`

The server stops at startup while it loads the translations.

**When:** a declared error code has no row in the fallback language (English) in the `translations` collection: its migration was not applied, or a row was deleted by hand.

**Why:** English is the last step of every language's chain; without it a client could receive a code with no message.

**Fix:** apply the migration that writes the code's texts, or add the English text to that migration and run it.

```sh
bun run db:migrate
```

## `no translations in the fallback language "en"`

The server stops at startup while it loads the translations.

**When:** the `translations` collection holds no row at all in English: the migrations were never applied to this database (a new or emptied one), or the collection was dropped.

**Why:** English is the last step of every language's chain, so with no English rows no refusal can be worded.

**Fix:** apply the migrations.

```sh
bun run db:migrate
```

## `TOTP_KEYS: ...`

The server stops at startup while it reads the environment.

**When:** `TOTP_KEYS` is missing in production, an entry has no `id:` (`id:key`), two entries share an id, a key is not 32 random bytes in base64, or the development key is used in production.

**Fix:** generate a key and list it as `id:key`; the first entry seals, every entry opens.

```sh
echo "TOTP_KEYS=k1:$(openssl rand -base64 32)"
```

## `MAIL_URL`, `UI_ORIGIN` or `MAIL_FROM` is invalid

The server stops at startup while it reads the environment.

**When:** `MAIL_URL` is not `smtp://` or `smtps://`, `UI_ORIGIN` is not an origin (`https://app.example.com`, no path), or `MAIL_FROM` is not a plain e-mail address.

**Fix:** correct the variable. Unset `MAIL_URL` prints the mails to the console instead (tokens redacted outside `NODE_ENV=development`).

## Sign-up or sign-in fails with a missing index or validator

Identity operations fail on first use, or two accounts share an address.

**When:** the identity collections (users, sessions, tokens, relations, API keys) were never synced. Outside production the server syncs them at boot; in production only with `MONGO_AUTO_SYNC`.

**Fix:** run the schema step of the deploy.

```sh
bun run db:sync
```

## Second factors no longer open (a lost `TOTP_KEYS` key)

A user who enrolled an authenticator cannot confirm a code, or the server cannot read the secret.

**Why:** the secrets are sealed with a key of `TOTP_KEYS`; every key that ever sealed one must stay listed to open it. A key removed from the list makes its secrets unreadable.

**Fix:** restore the key. When it is truly lost, the affected accounts must have their second factor reset by an operator (clear it in the `users` collection) and enrol again.

## `auth.errors.rate-limited` (429) on sign-up, sign-in or reset

**When:** a client address went past `RATE_LIMIT_SIGN_UP`, `RATE_LIMIT_SIGN_IN` or `RATE_LIMIT_PASSWORD_RESET` (`<attempts>/<seconds>`), or janus's per-account throttle (five mails per address and ten minutes, the tries of a challenge) tripped. `extensions.retryAfter` says how long to wait.

**Why:** behind a proxy every visitor looks like one address unless the forwarded address is honoured (`API_PROXY_SECRET`, `src/http/client-ip.ts`).

**Fix:** wait, or raise the variable. The limit is off when `REDIS_URL` is unset.
