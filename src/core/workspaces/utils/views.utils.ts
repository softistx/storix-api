import type { WorkspaceRole } from "../../members";
import type { Workspace } from "../services";

export const view = (workspace: Workspace, myRole: WorkspaceRole) => ({
  id: workspace.id,
  slug: workspace.slug,
  name: workspace.name,
  myRole,
  createdAt: workspace.createdAt,
});
