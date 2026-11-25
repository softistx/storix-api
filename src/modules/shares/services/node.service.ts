import { tryObjectId } from "@softistx/mongo";
import type { RoleNode } from "./role.service";

// A node as the grants read it: the shape `roleOn` needs, its type and its
// name (the audit trail's).
export interface NodeRef extends RoleNode {
  type: string;
  name: string;
}

// The slice of the nodes collection this module reads. The `nodes` module
// owns the collection and depends on this one (its guards ask `roleOn`), so
// this module reads the one row it shares through a structural handle instead
// of importing the module back.
interface NodesRead {
  db: {
    nodes: {
      findFirst(filter: Record<string, unknown>): Promise<NodeRef | undefined>;
    };
  };
}

// The live node with this id, whoever owns it, or undefined: a malformed id,
// an unknown one and a trashed node (its grants have no effect) alike.
export async function findLiveNode(
  database: unknown,
  id: string,
): Promise<NodeRef | undefined> {
  const objectId = tryObjectId(id);
  if (!objectId) return undefined;
  return (database as NodesRead).db.nodes.findFirst({
    _id: objectId,
    trashedAt: null,
  });
}
