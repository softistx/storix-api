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
| `Workspace` | The tenant. Registered in the core database, with its own database `storix_ws_<id>` (`MONGO_WORKSPACE_PREFIX`). Built by E1.                                         |
| `Principal` | Who a request is from, as the `Identity` port (`src/core/identity`) gives it. The rest of the API stores an `accountId` as an opaque string and never imports janus. |

## Error codes

A refusal carries a code `<module>.errors.<slug>`, declared per module with `defineCodes` (A1).
`bun run context:check` fails when a declared code has no row here. No code is declared yet.

| Code | Meaning |
| ---- | ------- |
