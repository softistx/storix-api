import type { Who } from "@/core/members";
import { reaches } from "../rules";
import { ownerOnly, shareNotFound } from "../shares.errors";
import { findLiveNode, type NodeRef } from "./node.service";
import { roleOn } from "./role.service";

// The node a caller shares: 404 when the caller cannot read it (a stranger's,
// another workspace's, a trashed one: one answer), `owner-only` (403) when the
// caller reads it without being able to share it (a viewer).
export async function nodeToShare(
  database: unknown,
  who: Who,
  id: string,
): Promise<NodeRef> {
  const node = await findLiveNode(database, id);
  const role = node ? await roleOn(database, who, node) : null;
  if (!node || role === null) throw shareNotFound();
  if (!reaches(role, "EDITOR")) throw ownerOnly();
  return node;
}

// The node and the caller's role on it, for a read of its grants: 404 when the
// caller cannot read it.
export async function nodeToRead(
  database: unknown,
  who: Who,
  id: string,
): Promise<NodeRef> {
  const node = await findLiveNode(database, id);
  if (!node || (await roleOn(database, who, node)) === null) {
    throw shareNotFound();
  }
  return node;
}
