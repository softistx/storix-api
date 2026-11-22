# storix-api: agent instructions

Global rules: `~/.claude/CLAUDE.md`. The product's: `~/workspace/dev/storix/AGENTS.md`; the v1 plan is `docs/plan.md`
(and `~/workspace/dev/storix/docs/plan.md`).
- Conventions followed without departure: the `alxia-graphql-api` and `bun-api` plugins. The worked example is schoolz-api (`~/workspace/dev/schoolz/schoolz-api/AGENTS.md`, "Modules"); the layout below is its role table adapted to storix.
- Default branch `develop`; one integration branch `feat/<slug>` per effort, slices as PRs into it, one PR from it into `develop`.
- Work is planned as issues: one tracking issue per effort, one issue per slice.
- The local green bar (`bun run verify`, `verify:pr` for a PR's affected specs) is the proof while the organisation's workflows are disabled; `.github/workflows/ci.yml` is the same bar in one job.
- `src/core/` is the kernel and depends on no business module; `src/modules/registry.ts` is the ONE list of modules. `bun run verify` checks the boundaries (`test/boundaries.spec.ts`).
- Type checking is `bun check`; Biome's scripts are `lint` and `fix`.
- The identity seam: only `src/core/identity/**` and `src/config/auth.ts` import `@softistx/janus*` (`bun run deps:check`, part of `verify`). Every other module keeps `accountId` as an opaque string.
- `@softistx/*` comes from npmjs like every other package (no token needed), as do `@nxgt/*`. Install with `bun install`.
- Dev services use ports 27019, 6381, 1027/8027 and 8333 so they run beside the other products' stacks.
- A gap in an in-house package is filed on that package, never worked around. No third-party client where a `@softistx/*` or `@nxgt/*` package covers the need.
- Files are split by responsibility, one role per file named for it (`csrf.ts`, `client-ip.ts`), about 250 lines at most, a service excepted (see "Modules" for the layout of a module). Generated code lives in `src/generated/` (git-ignored, written by `bun run generate`), never next to the sources.
- Conventions every slice keeps: a workspace database is typed through its module's one handle function (`filesMongo`, `nodesMongo`: no `as` cast at a call site); no module-global state, a check or hook a kernel module needs is handed in by the app (`createApp`'s options, as `media.fileReader`); a spec file stays near 250 lines, split by what it checks (see "Modules"; `services/focal.rules.service.spec.ts`); an index that carries a name sort carries the name collation, and changing an index comes with a migration.
- A new migration's id must sort after the last shipped id (dates may run ahead of the calendar), and its id goes into the shipped list of `src/config/migrations.spec.ts` when it ships.

## Modules

A module is `src/modules/<name>/` (a kernel module is `src/core/<name>/`, same layout), its files named `<name>.<role>.ts`. The registry (`src/modules/registry.ts`) lists the modules; a module's `public.ts` is what the other modules import (a kernel module's `index.ts`). This is the target layout: the existing modules are still flat (`files`, `identity`, ...) and move one by one in layout-only PRs (tracking issue #158).

| File | Holds |
| --- | --- |
| `graphql/<name>.graphqls` | the module's SDL (flat `<name>.graphqls` when it has one) |
| `models/<name>.model.ts` | the `@softistx/mongo` collection: Zod schema, indexes, and the module's one typed handle function (`filesMongo`, `nodesMongo`); `models/index.ts` barrel |
| `services/<domain>.service.ts` | the business rules, one service per domain (the entity or aggregate its methods act on), its single entry point; no split by kind of work. With data-loaders, the only code that reads or writes a model. `services/index.ts` is the barrel and holds the module's factory |
| `resolvers/<name>.resolver.ts` | thin resolvers calling the services; `resolvers/support.ts` holds what they share (storix's name, deliberately not schoolz's `<name>.resolver-support.ts`); `resolvers/index.ts` barrel |
| `data-loaders/<what>.data-loader.ts` | the module's DataLoaders, each with its spec; one file `<name>.data-loader.ts` while it fits; a field that reads per parent goes through a loader, never a query per row |
| `<name>.errors.ts` | the module's refusals and its `defineCodes("<name>", [...])` codes; a service throws its module's codes through it, never an inline code (`src/i18n/codes.ts` only gathers the modules' codes into `errorCodes`/`ErrorCode`; `context:check` reads every `defineCodes` call under `src/`; an errors file stays at the module root, or beside the service it belongs to when that moves, e.g. `janus.errors.ts` with `services/janus/`) |
| `<name>.rules.ts` (`rules/` when several) | pure rules and computations, no storage |
| `<name>.utils.ts` (`utils/<what>.utils.ts` when several, barrel) | small helpers that are not a business rule, reading or writing no collection, each with its spec |
| `module.ts`, `<name>.port.ts`, `migrations/` | roles kept at the root as they are (the registry may import a module's `module.ts`) |

- **Flat or folders**: a role with one file stays flat at the module's root; as soon as a role has several files they go in a folder named after the role, with a `<role>/index.ts` barrel (`graphql/` has none: codegen reads `src/**/*.graphqls`, and each `module.ts` imports its SDL by path, so a move updates that import). Single-file roles stay at the root. Imports inside a module are relative; `@/...` is for another module.
- **Sizes**: every source file stays under 250 lines, except a service (`*.service.ts`), which holds all its domain's methods at any length; each method stays under 50 lines, each other function under 80. Pure parts go to rules or utils, steps to private methods. A service past 600 lines is raised with the owner in the PR (a figure taken from schoolz-api).
- **No helper function at the top level of a service, a resolver or a data-loader** (`*.service.ts`, `*.resolver.ts`, `*.data-loader.ts`, `resolvers/support.ts`): such a file holds its role (the class or factory, the resolver map, the loader factory). A small helper moves to the module's utils, rules or errors file by what it does, with its spec. Top-level `const` data used by that file alone may stay. A helper used by several modules goes to a shared file, never copied.
- **Specs**: storix's specs run at the GraphQL level, named by behaviour. A spec exercising one service sits beside it as `services/<domain>.service.spec.ts` while it stays under 250 lines, otherwise split by behaviour as `services/<domain>.<behaviour>.service.spec.ts` (existing behaviour specs are moved or renamed, never rewritten, and a layout move adds no new unit specs); a flow crossing several modules stays at the module's root as `<name>.<what>.integration.spec.ts`. A spec file stays near 250 lines, split by what it checks, and a spec callback under 80 lines. Every data-loader and util has its spec beside it.
- **No loose null checks**: never `== null` / `!= null`; compare `=== null` or `=== undefined` by the type (Biome's `noDoubleEquals` with `ignoreNull: false` is on).
- **Identity**: the `janus.*` files of `src/core/identity` become services under `services/janus/`; the ports (`identity.port.ts`) stay at the root.
- **Layout moves** change no behaviour: renames, import updates and helper lifts only, reviewed with `git diff -M`; the boundary specs and `docs/` paths stay current.
