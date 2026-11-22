// An entry purged by an outer one, or restored, since the list was read.
const SETTLED = new Set(["nodes.errors.not-found", "trash.errors.not-trashed"]);

export const isSettled = (error: unknown) =>
  SETTLED.has(
    String((error as { extensions?: { code?: unknown } })?.extensions?.code),
  );
