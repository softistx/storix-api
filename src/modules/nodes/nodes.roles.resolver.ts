import type { Context } from "@/http/context";
import { grantView } from "@/modules/shares/public";
import { grantsOfNode, roleOfNode } from "./data-loaders";
import { nodeNotFound } from "./nodes.errors";

type NodeView = {
  id: string;
  ancestors: readonly string[];
  ownerId: string | null;
  trashedAt?: Date | null;
};

// `Node.myRole` and `Node.grants`, shared by `Folder` and `File`: the caller's
// effective role on the node, and the shares on the node itself, which only an
// owner or an editor sees. Both read through the request's roles loaders.
export const nodeRoleFields = {
  myRole: async (node: NodeView, _: unknown, ctx: Context) => {
    const role = await roleOfNode(node, ctx);
    if (!role) throw nodeNotFound();
    return role;
  },
  grants: async (node: NodeView, _: unknown, ctx: Context) => {
    const role = await roleOfNode(node, ctx);
    if (role !== "OWNER" && role !== "EDITOR") return [];
    return (await grantsOfNode(node.id, ctx)).map(grantView);
  },
};
