import type { Who } from "@/core/members";
import type { NodeDoc } from "@/modules/nodes/public";
import { rolesOn } from "@/modules/shares/public";
import type { FilesMongo } from "../models";

// The most files one call answers.
export const MAX_LARGEST = 50;

// How many files one read looks at, and how many reads one call makes at most:
// files the caller cannot read are skipped, so a call may take several reads.
const BATCH = 100;
const MAX_READS = 10;

// The largest current files of the workspace the caller may read, biggest
// first (ties newest first). Trashed files and folders are left out. A file in
// another member's private tree is not named to the caller, so the answer is
// what the caller reaches: a workspace of one member sees every file.
export async function largestFiles(
  mongo: FilesMongo,
  input: { who: Who; first: number },
): Promise<NodeDoc[]> {
  const first = Math.min(Math.max(input.first, 0), MAX_LARGEST);
  const found: NodeDoc[] = [];
  let last: NodeDoc | undefined;
  for (let reads = 0; found.length < first && reads < MAX_READS; reads++) {
    const size = last?.size ?? 0;
    const batch = await mongo.db.nodes.findMany({
      filter: {
        type: "FILE",
        trashedAt: { $type: "null" },
        ...(last && {
          $or: [{ size: { $lt: size } }, { size, _id: { $lt: last._id } }],
        }),
      },
      sort: { size: -1, _id: -1 },
      limit: BATCH,
    });
    const roles = await rolesOn(mongo, input.who, batch);
    for (const [i, node] of batch.entries()) {
      if (roles[i] !== null && found.length < first) found.push(node);
    }
    last = batch.at(-1);
    if (batch.length < BATCH) break;
  }
  return found;
}
