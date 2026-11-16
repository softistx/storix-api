import { tenancy } from "@/config/tenancy";
import type { WorkspacesMongo } from "@/core/workspaces";
import { NODE } from "../src/modules/nodes/nodes.harness";
import type { filesWorld } from "./files.harness";
import { LIST as VERSIONS, versionsArea } from "./versions.harness";

const TRASHED = `${NODE} trashedAt trashedBy`;
export const TRASH = `mutation($ids: [ID!]!) { trashNodes(ids: $ids) { ${TRASHED} } }`;
export const RESTORE = `mutation($ids: [ID!]!) { restoreNodes(ids: $ids) { ${TRASHED} } }`;
export const PURGE = `mutation($ids: [ID!]!) { purgeNodes(ids: $ids) }`;
export const EMPTY = `mutation { emptyTrash }`;
export const LIST = `query($first: Int, $after: String) { trash(first: $first, after: $after) { nodes { ${TRASHED} } pageInfo { endCursor hasNextPage } } }`;
export const NODES = `query($parentId: ID!) { nodes(parentId: $parentId) { nodes { id name } } }`;
export const ONE = `query($id: ID!) { node(id: $id) { ${TRASHED} } }`;

export interface TrashedView {
  id: string;
  name: string;
  parentId: string | null;
  trashedAt: string | null;
  trashedBy: string | null;
}

// The versions area with the calls a trash spec makes.
export async function trashArea(files: ReturnType<typeof filesWorld>) {
  const a = await versionsArea(files);
  const ids = (nodes: readonly { id: string }[]) => nodes.map((n) => n.id);
  const list = async (variables: Record<string, unknown> = {}) => {
    const result = await a.send(LIST, variables);
    const page = result.data?.["trash"] as {
      nodes: TrashedView[];
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
    };
    return page;
  };
  const trashed = async () => (await list({ first: 100 })).nodes;
  const children = async (parentId: string) => {
    const result = await a.send(NODES, { parentId });
    const page = result.data?.["nodes"] as { nodes: { name: string }[] };
    return page.nodes.map((n) => n.name).sort();
  };
  const me = a.as(a.owner);
  const core = () => tenancy.core as unknown as WorkspacesMongo;
  return {
    ...a,
    core,
    folder: me.folder,
    names: me.names,
    versionsOf: (id: string) => a.send(VERSIONS, { id }),
    list,
    trashed,
    children,
    trash: (nodes: readonly { id: string }[]) =>
      a.send(TRASH, { ids: ids(nodes) }),
    restore: (nodes: readonly { id: string }[]) =>
      a.send(RESTORE, { ids: ids(nodes) }),
    purge: (nodes: readonly { id: string }[]) =>
      a.send(PURGE, { ids: ids(nodes) }),
    empty: () => a.send(EMPTY, {}),
    one: (id: string) => a.send(ONE, { id }),
  };
}

export const codeOf = (result: {
  errors?: readonly { extensions?: Record<string, unknown> }[] | undefined;
}) => result.errors?.[0]?.extensions?.["code"];
