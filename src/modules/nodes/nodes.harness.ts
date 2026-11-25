import { world } from "../../../test/workspaces.harness";

export const NODE = "id type name parentId ancestors depth version";
export const ROOTS = `{ roots { ${NODE} } }`;
export const CREATE = `mutation($parentId: ID!, $name: String!) { createFolder(parentId: $parentId, name: $name) { ${NODE} } }`;
export const RENAME = `mutation($id: ID!, $name: String!, $version: Int!) { renameNode(id: $id, name: $name, version: $version) { ${NODE} } }`;
export const MOVE = `mutation($ids: [ID!]!, $parentId: ID!) { moveNodes(ids: $ids, parentId: $parentId) { ${NODE} } }`;
export const FOLDERS = `query($parentId: ID) { folders(parentId: $parentId) { ${NODE} } }`;
export const PATH = `query($id: ID!) { nodePath(id: $id) { ${NODE} } }`;

export interface NodeView {
  id: string;
  type: string;
  name: string;
  parentId: string | null;
  ancestors: string[];
  depth: number;
  version: number;
}

type World = Awaited<ReturnType<typeof world>>;
type Caller = Parameters<World["send"]>[0];

// A workspace with its owner, and calls that speak as a member of it.
export async function setup(existing?: World) {
  const w = existing ?? (await world());
  const workspace = await w.workspaceOf();
  const at = { workspace: workspace.id };
  const as = (user: Caller) => ({
    send: (query: string, variables?: Record<string, unknown>) =>
      w.send(user, query, { ...at, ...(variables && { variables }) }),
    root: async () => {
      const result = await w.send(user, ROOTS, at);
      if (result.errors) throw new Error(JSON.stringify(result.errors));
      return ((result.data?.["roots"] ?? []) as NodeView[])[0] as NodeView;
    },
    // Creates a folder and answers it; throws on a refusal.
    folder: async (parentId: string, name: string) => {
      const result = await w.send(user, CREATE, {
        ...at,
        variables: { parentId, name },
      });
      if (result.errors) throw new Error(JSON.stringify(result.errors));
      return result.data?.["createFolder"] as NodeView;
    },
    // The folders under a node, by name.
    names: async (parentId: string) => {
      const result = await w.send(user, FOLDERS, {
        ...at,
        variables: { parentId },
      });
      return ((result.data?.["folders"] ?? []) as NodeView[]).map(
        (n) => n.name,
      );
    },
  });
  return { w, workspace, at, owner: as(workspace.owner), as };
}
