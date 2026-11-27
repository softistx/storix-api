import { store } from "@/config/tenancy";
import type { filesWorld } from "../../../../test/files.harness";
import { NODE, setup } from "../../../../test/nodes.harness";
import { filesMongo } from "../models";

export const STAR = `mutation($id: ID!, $starred: Boolean!) { setStarred(id: $id, starred: $starred) { ${NODE} } }`;
export const OPEN = `mutation($id: ID!) { openFile(id: $id) { ${NODE} } }`;
export const STARRED = `query($first: Int, $after: String) { starred(first: $first, after: $after) { nodes { ${NODE} } pageInfo { endCursor hasNextPage } } }`;
export const RECENT = `query($first: Int, $after: String) { recentFiles(first: $first, after: $after) { entries { openedAt node { ${NODE} } } pageInfo { endCursor hasNextPage } } }`;

export interface Page {
  nodes: { id: string; name: string }[];
  pageInfo: { endCursor: string | null; hasNextPage: boolean };
}

export interface RecentPage {
  entries: { openedAt: string; node: { id: string; name: string } }[];
  pageInfo: Page["pageInfo"];
}

export async function area(files: ReturnType<typeof filesWorld>) {
  const s = await setup(files.ctx.w);
  const root = await s.owner.root();
  const { owner, id } = s.workspace;
  const db = filesMongo(await store.databaseOf(id));
  const file = (name: string, who = owner, parentId = root.id) =>
    files.addFile(who, id, parentId, name);
  const send = (
    user: typeof owner,
    query: string,
    vars: Record<string, unknown> = {},
  ) => s.w.send(user, query, { ...s.at, variables: vars });
  const names = async (
    user: typeof owner,
    query: string,
    key: "starred" | "recentFiles",
    vars: Record<string, unknown> = {},
  ) => {
    const r = await send(user, query, vars);
    if (key === "recentFiles") {
      const page = r.data?.[key] as RecentPage | undefined;
      return (page?.entries ?? []).map((e) => e.node.name);
    }
    return ((r.data?.[key] as Page | undefined)?.nodes ?? []).map(
      (n) => n.name,
    );
  };
  const trash = (nodeId: string, at: Date | null) =>
    db.db.nodes.updateMany({ _id: nodeId as never }, { trashedAt: at });
  return { ...s, root, db, file, send, names, owner, trash };
}

export const code = (r: {
  errors?: readonly { extensions?: unknown }[] | undefined;
}) => (r.errors?.[0]?.extensions as { code?: string } | undefined)?.code;
