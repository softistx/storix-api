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
