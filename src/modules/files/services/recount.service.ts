import type { FilesMongo } from "../models";

// What the workspace database really holds: the bytes of the blobs some node,
// version or copy still references (`refs > 0`, each blob once, so a copy that
// shares a blob adds nothing), the part of them no node holds (only versions
// do: `versionBytes`), the part only trashed nodes hold (`trashBytes`), and
// its live file nodes. The truth the counters of `workspaces.usage` are
// reconciled to (plan §3.9); `mongo` is a transaction's when the answer must
// be consistent with a write that follows.
export async function recountStorage(mongo: FilesMongo): Promise<{
  bytes: number;
  files: number;
  versionBytes: number;
  trashBytes: number;
}> {
  const blobs = mongo.db.blobs;
  const holders = (as: string, live: boolean) => ({
    $lookup: {
      from: "nodes",
      localField: "key",
      foreignField: "blobKey",
      pipeline: [
        ...(live ? [{ $match: { trashedAt: null } }] : []),
        { $limit: 1 },
        { $project: { _id: 1 } },
      ],
      as,
    },
  });
  const rows = await blobs.raw
    .aggregate<{ _id: "live" | "trash" | "versions"; bytes: number }>(
      [
        { $match: { refs: { $gt: 0 } } },
        holders("live", true),
        holders("any", false),
        {
          $group: {
            _id: {
              $cond: [
                { $gt: [{ $size: "$live" }, 0] },
                "live",
                {
                  $cond: [{ $gt: [{ $size: "$any" }, 0] }, "trash", "versions"],
                },
              ],
            },
            bytes: { $sum: "$size" },
          },
        },
      ],
      blobs.session ? { session: blobs.session } : {},
    )
    .toArray();
  const of = (state: string) => rows.find((r) => r._id === state)?.bytes ?? 0;
  return {
    bytes: of("live") + of("trash") + of("versions"),
    versionBytes: of("versions"),
    trashBytes: of("trash"),
    files: await mongo.db.nodes.count({ type: "FILE", trashedAt: null }),
  };
}
