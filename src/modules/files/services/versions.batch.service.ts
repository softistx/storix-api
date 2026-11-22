import { tryObjectId } from "@softistx/mongo";
import { nodeNotFound, nodesMongo } from "@/modules/nodes/public";
import { notAFile } from "../files.errors";
import type { FilesMongo } from "../models";
import { listVersions, type VersionDoc } from "./versions.service";

export type VersionsOfFile = { rows: VersionDoc[]; currentId: string | null };

// `listVersions` for many files in one round: the caller's files in one read
// of the nodes and their versions in one read of the versions, newest first.
// Answers, per id and in order, the versions or the error the single call would
// have thrown (`nodes.errors.not-found`, `files.errors.not-a-file`). A file
// recorded before versions existed takes the single call, which makes its
// version 1.
export async function listVersionsBatch(
  mongo: FilesMongo,
  input: { ids: readonly string[]; accountId: string },
): Promise<(VersionsOfFile | Error)[]> {
  const objectIds = input.ids.flatMap((id) => tryObjectId(id) ?? []);
  const nodes = await nodesMongo(mongo).db.nodes.findMany({
    filter: {
      _id: { $in: objectIds },
      ownerId: input.accountId,
      trashedAt: null,
    },
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const current = nodes.filter((n) => n.type === "FILE" && n.currentVersionId);
  const rows = current.length
    ? await mongo.db.versions.findMany({
        filter: { fileId: { $in: current.map((n) => n._id) } },
        sort: { number: -1 },
      })
    : [];
  const rowsOf = Map.groupBy(rows, (row) => row.fileId.toHexString());
  return Promise.all(
    input.ids.map(async (id) => {
      const node = byId.get(id);
      if (!node) return nodeNotFound();
      if (node.type !== "FILE") return notAFile();
      if (!node.currentVersionId) {
        return listVersions(mongo, { id, accountId: input.accountId }).catch(
          (error: Error) => error,
        );
      }
      return {
        rows: rowsOf.get(id) ?? [],
        currentId: node.currentVersionId.toHexString(),
      };
    }),
  );
}
