import { tryObjectId } from "@softistx/mongo";
import { type NodeRef, nodesRead } from "../models/nodes.handle";

export type { NodeRef };

// The live node with this id, whoever owns it, or undefined: a malformed id,
// an unknown one and a trashed node (its grants have no effect) alike.
export async function findLiveNode(
  database: unknown,
  id: string,
): Promise<NodeRef | undefined> {
  const objectId = tryObjectId(id);
  if (!objectId) return undefined;
  return nodesRead(database).db.nodes.findFirst({
    _id: objectId,
    trashedAt: null,
  });
}
