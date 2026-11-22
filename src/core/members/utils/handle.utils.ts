import { membersMongo } from "../models";

// The module's own handle on the core database (the scope's, typed by the
// registry; see src/core/access/ports.ts).
export const handleOf = (scope: { readonly core: unknown }) =>
  membersMongo(scope.core);
