import { toObjectId } from "@softistx/mongo";
import type { WorkspacesMongo } from "./workspaces.service";

// Sets a workspace's display name; the slug and the id never change. Like the
// settings, it leaves the row's `version` alone (a rename never fails a
// concurrent settings change). `false` for an unknown workspace.
export async function renameWorkspace(
  mongo: WorkspacesMongo,
  workspaceId: string,
  name: string,
): Promise<boolean> {
  const done = await mongo.db.workspaces.raw.updateOne(
    { _id: toObjectId(workspaceId) },
    { $set: { name, updatedAt: new Date() } },
  );
  return done.matchedCount > 0;
}
