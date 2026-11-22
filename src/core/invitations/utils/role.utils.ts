import type { WorkspaceRole } from "../../members";
import { workspaceRoles } from "../../members";

export const isRole = (role: string): role is WorkspaceRole =>
  (workspaceRoles as readonly string[]).includes(role);
