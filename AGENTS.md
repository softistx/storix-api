# storix-api: agent instructions

Global rules: `~/.claude/CLAUDE.md`. The product's: `~/workspace/dev/storix/AGENTS.md`; the v1 plan is `docs/plan.md`
(and `~/workspace/dev/storix/docs/plan.md`).
- Conventions followed without departure: the `alxia-graphql-api` and `bun-api` plugins.
- Default branch `develop`; one integration branch `feat/<slug>` per effort, slices as PRs into it, one PR from it into `develop`.
- Work is planned as issues: one tracking issue per effort, one issue per slice.
- The local green bar (`bun run verify`, `verify:pr` for a PR's affected specs) is the proof while the organisation's workflows are disabled; `.github/workflows/ci.yml` is the same bar in one job.
- `src/core/` is the kernel and depends on no business module; `src/modules/registry.ts` is the ONE list of modules. `bun run verify` checks the boundaries (`test/boundaries.spec.ts`).
- Type checking is `bun check`; Biome's scripts are `lint` and `fix`.
- The identity seam: only `src/core/identity/**` and `src/config/auth.ts` import `@softistx/janus*` (`bun run deps:check`, part of `verify`). Every other module keeps `accountId` as an opaque string.
- `@softistx/*` comes from npmjs like every other package (no token needed), as do `@nxgt/*`. Install with `bun install`.
- Dev services use ports 27019, 6381, 1027/8027 and 8333 so they run beside the other products' stacks.
- A gap in an in-house package is filed on that package, never worked around. No third-party client where a `@softistx/*` or `@nxgt/*` package covers the need.
- Files are split by responsibility, one role per file named for it (`csrf.ts`, `client-ip.ts`; a spec is `<name>.spec.ts` beside its file), about 250 lines at most. Generated code lives in `src/generated/` (git-ignored, written by `bun run generate`), never next to the sources.
- Conventions every slice keeps: a workspace database is typed through its module's one handle function (`filesMongo`, `nodesMongo`: no `as` cast at a call site); no module-global state, a check or hook a kernel module needs is handed in by the app (`createApp`'s options, as `media.fileReader`); a spec file stays near 250 lines, split by what it checks (`files.focal.rules.spec.ts`); an index that carries a name sort carries the name collation, and changing an index comes with a migration.
- A new migration's id must sort after the last shipped id (dates may run ahead of the calendar), and its id goes into the shipped list of `src/config/migrations.spec.ts` when it ships.
