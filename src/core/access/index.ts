// The access surface: guards for the operations of a workspace and the
// permission catalogue's builder. Everything else in this folder is private.

export {
  type Guarded,
  requireAccountSession,
  requireWorkspaceMember,
  requireWorkspacePermission,
} from "./guards";
export type { TenancyPort, WorkspaceScope } from "./ports";
export { apiRefusal } from "./refusals";
