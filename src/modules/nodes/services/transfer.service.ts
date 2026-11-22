import type { NodesMongo } from "../models";
import { named } from "../nodes.errors";
import { transferLabel } from "../utils";
import { freeName } from "./file.service";
import { ensureRoot, lockTree } from "./nodes.service";

// Hands a leaver's whole tree to another member: the leaver's root stops being
// a root and becomes a folder of the receiver's root (named `Files of <name>`,
// numbered when taken), and every node under it, trashed ones included, is
// owned by the receiver. One transaction, so a tree is never half moved. The
// depth rule is not re-checked: a tree that was 16 deep is now 17, and only
// takes no further subfolder. Answers whether the leaver had a tree.
export async function transferTree(
  mongo: NodesMongo,
  input: { fromAccountId: string; toAccountId: string; name: string | null },
): Promise<boolean> {
  await ensureRoot(mongo, input.toAccountId);
  return named(() =>
    mongo.transaction(async (tx) => {
      await lockTree(tx, input.toAccountId);
      await lockTree(tx, input.fromAccountId);
      const from = await tx.db.nodes.findFirst({
        ownerId: input.fromAccountId,
        parentId: null,
        trashedAt: null,
      });
      const to = await tx.db.nodes.findFirst({
        ownerId: input.toAccountId,
        parentId: null,
        trashedAt: null,
      });
      if (!from || !to) return false;
      const name = await freeName(tx, to, transferLabel(input.name));
      await tx.db.nodes.updateMany(
        { ancestors: from._id },
        {
          $set: { ownerId: input.toAccountId },
          $push: { ancestors: { $each: [to._id], $position: 0 } },
        },
      );
      await tx.db.nodes.as(input.toAccountId).update(from._id, {
        name,
        parentId: to._id,
        ancestors: [to._id],
        ownerId: input.toAccountId,
        version: from.version,
      });
      return true;
    }),
  );
}
