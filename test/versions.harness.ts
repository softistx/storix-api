import { store, tenancy } from "@/config/tenancy";
import type { WorkspacesMongo } from "@/core/workspaces";
import { filesMongo } from "@/modules/files/public";
import { setup } from "../src/modules/nodes/nodes.harness";
import { FILE, type FileView, type filesWorld } from "./files.harness";

export const VERSIONS = `{ id number key mimeType size createdBy note restoredFrom current createdAt }`;
export const ADD_VERSION = `mutation($fileId: ID!, $key: String!, $note: String) { addFileVersion(fileId: $fileId, key: $key, note: $note) { ${FILE} } }`;
export const RESTORE = `mutation($fileId: ID!, $versionId: ID!, $note: String) { restoreFileVersion(fileId: $fileId, versionId: $versionId, note: $note) { ${FILE} } }`;
export const DELETE = `mutation($fileId: ID!, $versionId: ID!) { deleteFileVersion(fileId: $fileId, versionId: $versionId) { ${FILE} } }`;
export const LIST = `query($id: ID!) { node(id: $id) { ... on File { versions ${VERSIONS} } } }`;

export interface VersionView {
  id: string;
  number: number;
  key: string;
  size: number;
  restoredFrom: number | null;
  note: string | null;
  current: boolean;
}

// The world of the nodes specs over the files' storage, with the calls a
// versions spec makes: add a file, add a version, list, restore, delete.
export async function versionsArea(files: ReturnType<typeof filesWorld>) {
  const s = await setup(files.ctx.w);
  const { id, owner } = s.workspace;
  const root = await s.owner.root();
  const mongo = filesMongo(await store.databaseOf(id));
  const send = (query: string, variables: Record<string, unknown>) =>
    s.w.send(owner, query, { workspace: id, variables });
  const add = (name: string, body = name): Promise<FileView> =>
    files.addFile(owner, id, root.id, name, body);
  const push = async (fileId: string, body: string, note?: string) => {
    const up = await files.upload(owner, id, body);
    const result = await send(ADD_VERSION, { fileId, key: up.key, note });
    return { up, result };
  };
  const versions = async (fileId: string) => {
    const result = await send(LIST, { id: fileId });
    return ((result.data ?? {})["node"] as { versions: VersionView[] })
      .versions;
  };
  const usage = async () =>
    (
      await (tenancy.core as unknown as WorkspacesMongo).db.workspaces.getById(
        id,
      )
    ).usage;
  return { ...s, usage, id, owner, root, mongo, send, add, push, versions };
}
