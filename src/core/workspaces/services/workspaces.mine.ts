import { membershipsOfAccount, type WorkspaceRole } from "../../members";
import { type Workspace, workspaceOf } from "./workspaces.registry";
import type { WorkspacesMongo } from "./workspaces.service";

// The open workspaces an account belongs to, by name, each with the account's
// role in it.
export async function workspacesOfAccount(
  mongo: WorkspacesMongo,
  accountId: string,
): Promise<{ workspace: Workspace; role: WorkspaceRole }[]> {
  const memberships = await membershipsOfAccount(mongo, accountId);
  const roles = new Map(
    memberships.map((m) => [m.workspaceId.toHexString(), m.role]),
  );
  const found = await mongo.db.workspaces.findMany({
    filter: {
      _id: { $in: memberships.map((m) => m.workspaceId) },
      status: "active",
    },
    sort: { name: 1 },
  });
  return found.map((doc) => ({
    workspace: workspaceOf(doc),
    role: roles.get(doc.id) ?? "MEMBER",
  }));
}
