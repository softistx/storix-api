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
- `@softistx/*` comes from GitHub Packages through the committed `.npmrc` (`GITHUB_TOKEN` with `read:packages`); `@alxia/*` and `@nxgt/*` from npmjs. Install with `GITHUB_TOKEN=$(gh auth token) bun install`.
- Dev services use ports 27019, 6381, 1027/8027 and 8333 so they run beside the other products' stacks.
- A gap in an in-house package is filed on that package, never worked around. No third-party client where an `@alxia/*`, `@softistx/*` or `@nxgt/*` package covers the need.
- Files are split by responsibility, one role per file named for it (`csrf.ts`, `client-ip.ts`; a spec is `<name>.spec.ts` beside its file), about 250 lines at most. Generated code lives in `src/generated/` (git-ignored, written by `bun run generate`), never next to the sources.
