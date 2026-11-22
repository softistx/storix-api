import type { WorkspacesMongo } from "../services/workspaces.service";

// The one place the core database becomes the `workspaces` module's typed
// handle: `ctx.tenancy.core` and a store's `core` are plain records to the
// compiler (src/core/access/ports.ts), so every reader goes through this
// function instead of casting.
export const workspacesMongo = (core: unknown): WorkspacesMongo =>
  core as WorkspacesMongo;
