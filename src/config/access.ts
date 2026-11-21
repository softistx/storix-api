import { type Access, createAccess } from "@softistx/alxia-access";
import { type WorkspaceRole, workspaceRoles } from "../core/members";
import { modules } from "../modules/registry";

// The permission matrix: what each workspace role holds, built from what the
// registered modules declare (`permissions`, `defaultGrants`). OWNER holds
// every permission. Throws at boot for a mistyped permission or a grant to an
// unknown role.
export const access: Access<WorkspaceRole> = createAccess(modules, {
  roles: workspaceRoles,
  all: "OWNER",
});
