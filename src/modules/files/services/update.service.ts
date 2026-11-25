import { accountOf, type Who } from "@/core/members";
import { type NodeDoc, named, nodeFor } from "@/modules/nodes/public";
import { notAFile } from "../files.errors";
import type { FilesMongo } from "../models";

// Sets the tags and the metadata of a file the caller owns or edits: each one
// given replaces the old value, one left out stays. With a `version`, the
// write holds only if the file is still at it (`nodes.errors.conflict`
// otherwise). `not-a-file` for a folder. Answers the file as it is now and as
// it was.
export async function updateFile(
  mongo: FilesMongo,
  input: {
    id: string;
    accountId: Who;
    tags?: string[];
    meta?: Record<string, unknown>;
    version?: number;
  },
): Promise<{ node: NodeDoc; before: NodeDoc }> {
  const before = await nodeFor(mongo, input.id, input.accountId, "EDITOR");
  if (before.type !== "FILE") throw notAFile();
  const node = await named(() =>
    mongo.db.nodes.as(accountOf(input.accountId)).update(before._id, {
      ...(input.tags !== undefined && { tags: input.tags }),
      ...(input.meta !== undefined && { meta: input.meta }),
      ...(input.version !== undefined && { version: input.version }),
    }),
  );
  return { node, before };
}
