import { store } from "@/config/tenancy";
import { filesMongo } from "../src/modules/files/public";
import { type filesWorld, pdf, png } from "./files.harness";
import { NODE, setup } from "./nodes.harness";

export const LIST = `query($parentId: ID!, $filter: NodeFilter, $sort: NodeSort, $first: Int, $after: String) {
  nodes(parentId: $parentId, filter: $filter, sort: $sort, first: $first, after: $after) {
    nodes { ${NODE} ... on File { key size family tags mimeType } }
    pageInfo { endCursor hasNextPage }
  }
}`;

export interface Row {
  id: string;
  type: string;
  name: string;
  size?: number;
  family?: string;
}

export function listKit(files: ReturnType<typeof filesWorld>) {
  // A folder holding two subfolders and files of different type, size and age.
  async function fixture() {
    const s = await setup(files.ctx.w);
    const { workspace, owner } = s;
    const root = await owner.root();
    const dir = await owner.folder(root.id, "box");
    await owner.folder(dir.id, "zeta");
    await owner.folder(dir.id, "Alpha");
    const add = (name: string, body: string | Uint8Array, type: string) =>
      files.addFile(workspace.owner, workspace.id, dir.id, name, body, type);
    const a = await add("b.txt", "x".repeat(30), "text/plain");
    await Bun.sleep(5);
    const b = await add("A.png", png(12), "image/png");
    await Bun.sleep(5);
    const c = await add("c.pdf", pdf(100), "application/pdf");
    await Bun.sleep(5);
    const d = await add("d.png", png(20), "image/png");
    const db = filesMongo(await store.databaseOf(workspace.id));
    return { ...s, dir, a, b, c, d, db };
  }

  const list = async (
    f: Awaited<ReturnType<typeof fixture>>,
    variables: Record<string, unknown>,
  ) => {
    const r = await f.w.send(f.workspace.owner, LIST, {
      ...f.at,
      variables: { parentId: f.dir.id, ...variables },
    });
    return r;
  };
  const rows = (r: Awaited<ReturnType<typeof list>>) =>
    (r.data?.["nodes"].nodes ?? []) as Row[];
  const names = (r: Awaited<ReturnType<typeof list>>) =>
    rows(r).map((n) => n.name);

  return { fixture, list, rows, names };
}
