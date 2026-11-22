import { toObjectId } from "@softistx/mongo";
import { DEFAULT_SETTINGS } from "../models/workspaces.model";
import type { WorkspacesMongo } from "./workspaces.service";

export type Settings = {
  -readonly [K in keyof typeof DEFAULT_SETTINGS]: number;
};

// The settings of a workspace, a default for each one it has not set (a
// workspace stored before they existed has none until the migration ran).
// `undefined` for an unknown workspace.
export async function settingsOf(
  mongo: WorkspacesMongo,
  workspaceId: string,
): Promise<Settings | undefined> {
  const doc = await mongo.db.workspaces.findById(workspaceId);
  return doc && { ...DEFAULT_SETTINGS, ...doc.settings };
}

// Sets the settings the patch names and leaves the others, without touching
// the row's `version` (a settings change never fails a concurrent rename).
// Answers the settings as they are now, `undefined` for an unknown workspace.
export async function updateSettings(
  mongo: WorkspacesMongo,
  workspaceId: string,
  patch: Partial<Settings>,
): Promise<Settings | undefined> {
  const set = Object.fromEntries(
    Object.entries(patch)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [`settings.${key}`, value]),
  );
  if (Object.keys(set).length > 0) {
    await mongo.db.workspaces.raw.updateOne(
      { _id: toObjectId(workspaceId) },
      { $set: set },
    );
  }
  return settingsOf(mongo, workspaceId);
}

// A `Workspace` as the resolvers answer it, without `settings`, which its own
// resolver reads.
export interface WorkspaceView {
  id: string;
  slug: string;
  name: string;
  myRole: "OWNER" | "ADMIN" | "MEMBER";
  createdAt: Date;
}
