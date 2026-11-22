import DataLoader from "dataloader";
import type { Context } from "@/http/context";

// The owner of a node as the API says it: the account's id and display name.
export interface NodeOwnerView {
  accountId: string;
  name: string;
}

// One loader per request: every node of a page asks for its owner, and the
// identity port is called once for the distinct owners (its `byIds` is the
// batch source). An account that no longer exists, or an identity store that
// cannot answer, reads as null: the owner is a courtesy of the node, never a
// reason to fail the read.
const loaders = new WeakMap<object, DataLoader<string, NodeOwnerView | null>>();

// `Node.owner`: null for a node that records no owner or whose account is gone.
export function ownerOf(
  node: { ownerId?: string | null },
  ctx: Context,
): Promise<NodeOwnerView | null> {
  if (!node.ownerId) return Promise.resolve(null);
  let loader = loaders.get(ctx);
  if (!loader) {
    loader = new DataLoader<string, NodeOwnerView | null>(async (ids) => {
      try {
        const accounts = await ctx.identity.accounts.byIds(ids);
        const byId = new Map(accounts.map((a) => [a.accountId, a]));
        return ids.map((id) => {
          const account = byId.get(id);
          return account ? { accountId: id, name: account.name } : null;
        });
      } catch {
        return ids.map(() => null);
      }
    });
    loaders.set(ctx, loader);
  }
  return loader.load(node.ownerId);
}
