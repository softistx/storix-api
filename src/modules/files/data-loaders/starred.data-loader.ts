import DataLoader from "dataloader";
import { ObjectId } from "mongodb";
import { requireWorkspacePermission } from "@/core/access";
import type { Context } from "@/http/context";
import { filesMongo } from "../models";

// One loader per request: every node of a page asks whether the caller starred
// it, and the `nodes:read` guard and the one read of `stars` (an `$in` over the
// page's ids) run once for the distinct nodes. Nothing is cached across loads
// (`cache: false`): `setStarred` may change a star before a later field reads
// it. A refused guard fails every node the same way.
const loaders = new WeakMap<object, DataLoader<string, boolean>>();

// `Node.starred`: whether the caller has starred the node.
export function starredOf(
  node: { id: string },
  ctx: Context,
): Promise<boolean> {
  let loader = loaders.get(ctx);
  if (!loader) {
    loader = new DataLoader<string, boolean>(
      async (ids) => {
        try {
          const { principal, scope } = await requireWorkspacePermission(
            ctx,
            "nodes:read",
          );
          const rows = await filesMongo(scope.mongo).db.stars.findMany({
            filter: {
              accountId: principal.accountId,
              nodeId: { $in: ids.map((id) => new ObjectId(id)) },
            },
          });
          const starred = new Set(rows.map((row) => row.nodeId.toHexString()));
          return ids.map((id) => starred.has(id));
        } catch (error) {
          return ids.map(() => error as Error);
        }
      },
      { cache: false },
    );
    loaders.set(ctx, loader);
  }
  return loader.load(node.id);
}
