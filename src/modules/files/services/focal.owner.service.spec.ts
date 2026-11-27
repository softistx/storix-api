import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import { actionsOf, storedEvents } from "@/core/audit/audit.harness";
import { code, field } from "../../../../test/files.area";
import { FOCAL, READ } from "../../../../test/files.focal.harness";
import { COPY, filesWorld, png } from "../../../../test/files.harness";
import { ROOTS } from "../../../../test/nodes.harness";
import { sharesArea } from "../../../../test/shares.harness";
import { filesMongo } from "../models";
import type { RenditionsQueue } from "../public";

// A queue that holds its jobs: no worker runs.
const queue: RenditionsQueue = { add: async () => ({}) };
const files = filesWorld({ renditions: queue });

// A picture in the owner's shared folder, and a copy of it in the editor's own
// "My files" (an editor may copy what a grant lets them read). The copy is
// owned by the editor: that is what makes it another tree's node.
async function picture() {
  const a = await sharesArea(files);
  const original = await files.addFile(
    a.users.owner,
    a.workspace.id,
    a.folder.id,
    "p.png",
    png(64),
    "image/png",
  );
  const roots = await a.sendAs(a.users.editor, ROOTS);
  const [root] = field<{ id: string }[]>(roots, "roots");
  const copied = await a.sendAs(a.users.editor, COPY, {
    ids: [original.id],
    parentId: root?.id,
  });
  expect(copied.errors).toBeUndefined();
  const [copy] = field<{ id: string }[]>(copied, "copyNodes");
  return { a, original, copy: copy as { id: string } };
}

const pointOf = async (a: Awaited<ReturnType<typeof sharesArea>>, id: string) =>
  field<{ focalPoint: unknown }>(
    await a.sendAs(a.users.owner, READ, { id }),
    "node",
  ).focalPoint;

describe("setFocalPoint only touches the caller's own tree", () => {
  test("a copy of the same owner takes the point too", async () => {
    const { a, original } = await picture();
    const copied = await a.sendAs(a.users.owner, COPY, {
      ids: [original.id],
      parentId: a.folder.id,
    });
    expect(copied.errors).toBeUndefined();
    const [own] = field<{ id: string }[]>(copied, "copyNodes");
    const moved = await a.sendAs(a.users.owner, FOCAL, {
      id: original.id,
      focalPoint: { x: 0.3, y: 0.6 },
    });
    expect(moved.errors).toBeUndefined();
    expect(await pointOf(a, (own as { id: string }).id)).toEqual({
      x: 0.3,
      y: 0.6,
    });
  });

  test("a copy another member holds keeps its point and its version", async () => {
    const { a, original, copy } = await picture();
    const db = filesMongo(await store.databaseOf(a.workspace.id));
    const before = await db.db.nodes.findFirst({ _id: copy.id as never });

    const moved = await a.sendAs(a.users.owner, FOCAL, {
      id: original.id,
      focalPoint: { x: 0.9, y: 0.1 },
    });
    expect(moved.errors).toBeUndefined();
    expect(await pointOf(a, original.id)).toEqual({ x: 0.9, y: 0.1 });

    const after = await db.db.nodes.findFirst({ _id: copy.id as never });
    expect(after?.focalPoint).toBeNull();
    expect(after?.version).toBe(before?.version);
    expect(after?.status).toBe(before?.status);
  });

  test("a viewer is refused and nothing is written, not even to the copies", async () => {
    const { a, original, copy } = await picture();
    const refused = await a.sendAs(a.users.viewer, FOCAL, {
      id: original.id,
      focalPoint: { x: 0.2, y: 0.2 },
    });
    expect(code(refused)).toBe("nodes.errors.not-found");
    expect(await pointOf(a, original.id)).toBeNull();
    const db = filesMongo(await store.databaseOf(a.workspace.id));
    const after = await db.db.nodes.findFirst({ _id: copy.id as never });
    expect(after?.focalPoint).toBeNull();
    expect(actionsOf(await storedEvents(a.workspace.id))).not.toContain(
      "file.focal",
    );
  });
});
