import { store } from "@/config/tenancy";
import { nodesMongo } from "@/modules/nodes/public";
import { createTeam, teamsMongo } from "@/modules/teams/public";
import { setup } from "../src/modules/nodes/nodes.harness";
import { sharesMongo } from "../src/modules/shares/models";
import type { Principal } from "../src/modules/shares/services/grants.service";

// A workspace with a tree (a root, a folder under it, a child of the folder
// and a sibling of the folder), direct handles on its database, and members
// to hold grants. No object storage: the services are called as they are.
export async function roleArea() {
  const s = await setup();
  const database = await store.databaseOf(s.workspace.id);
  const root = await s.owner.root();
  const folder = await s.owner.folder(root.id, "Shared");
  const child = await s.owner.folder(folder.id, "Child");
  const sibling = await s.owner.folder(root.id, "Sibling");
  const nodes = nodesMongo(database);
  const nodeOf = async (id: string) => {
    const node = await nodes.db.nodes.findFirst({ _id: id as never });
    if (!node) throw new Error(`no node ${id}`);
    return node;
  };
  const grant = (
    nodeId: string,
    principal: Principal,
    role: "VIEWER" | "EDITOR",
  ) =>
    sharesMongo(database)
      .db.grants.as("seed")
      .create({
        nodeId: nodeId as never,
        principal: { type: principal.type, id: principal.id as never },
        role,
        grantedBy: "seed",
      });
  const team = async (name: string, memberIds: string[]) => {
    const made = await createTeam(teamsMongo(database), name, "seed");
    await teamsMongo(database).db.teams.update(made._id, {
      memberIds: memberIds as never,
    });
    return made.id;
  };
  return { ...s, database, root, folder, child, sibling, nodeOf, grant, team };
}
