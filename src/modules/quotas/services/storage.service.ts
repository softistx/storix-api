import { storageOf, type WorkspacesMongo } from "@/core/workspaces";

export interface StorageView {
  quotaBytes: number;
  usedBytes: number;
  currentBytes: number;
  versionBytes: number;
  trashBytes: number;
  files: number;
}

// The storage of a workspace as the API shows it. `undefined` for a workspace
// the registry no longer knows.
export async function storageView(
  core: WorkspacesMongo,
  workspaceId: string,
): Promise<StorageView | undefined> {
  const storage = await storageOf(core, workspaceId);
  if (!storage) return undefined;
  const { bytes, files, versionBytes, trashBytes } = storage.usage;
  return {
    quotaBytes: storage.quotaBytes,
    usedBytes: bytes,
    currentBytes: Math.max(0, bytes - versionBytes - trashBytes),
    versionBytes,
    trashBytes,
    files,
  };
}
