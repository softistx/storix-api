import type { FilesMongo } from "./files.service";

// What the workspace database really holds: the bytes of the blobs some node,
// version or copy still references (`refs > 0`, each blob once, so a copy that
// shares a blob adds nothing), the part of them no node holds (only versions
// do: `versionBytes`), and its file nodes. The truth the counters of
// `workspaces.usage` are reconciled to (plan §3.9); `mongo` is a transaction's
// when the answer must be consistent with a write that follows.
export async function recountStorage(
  mongo: FilesMongo,
): Promise<{ bytes: number; files: number; versionBytes: number }> {
  const blobs = mongo.db.blobs;
  const [sum] = await blobs.raw
    .aggregate<{ bytes: number }>(
      [
        { $match: { refs: { $gt: 0 } } },
        { $group: { _id: null, bytes: { $sum: "$size" } } },
      ],
      blobs.session ? { session: blobs.session } : {},
    )
    .toArray();
  const [only] = await blobs.raw
    .aggregate<{ bytes: number }>(
      [
        { $match: { refs: { $gt: 0 } } },
        {
          $lookup: {
            from: "nodes",
            localField: "key",
            foreignField: "blobKey",
            pipeline: [{ $limit: 1 }, { $project: { _id: 1 } }],
            as: "held",
          },
        },
        { $match: { held: { $size: 0 } } },
        { $group: { _id: null, bytes: { $sum: "$size" } } },
      ],
      blobs.session ? { session: blobs.session } : {},
    )
    .toArray();
  return {
    bytes: sum?.bytes ?? 0,
    versionBytes: only?.bytes ?? 0,
    files: await mongo.db.nodes.count({ type: "FILE" }),
  };
}
