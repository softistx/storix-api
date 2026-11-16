import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import { updateSettings } from "@/core/workspaces";
import { filesWorld } from "../../../test/files.harness";
import { trashArea } from "../../../test/trash.harness";
import { retainTrash, retainTrashAll } from "./trash.retention";

const files = filesWorld();
const DAY = 86_400_000;

describe("trash retention", () => {
  test("purges the entries older than trashDays and keeps the others", async () => {
    const a = await trashArea(files);
    const old = await files.addFile(a.owner, a.id, a.root.id, "old.txt", "old");
    const fresh = await files.addFile(
      a.owner,
      a.id,
      a.root.id,
      "new.txt",
      "new",
    );
    await a.trash([old]);
    await a.trash([fresh]);
    await a.mongo.db.nodes.raw.updateOne(
      { name: "old.txt" },
      { $set: { trashedAt: new Date(Date.now() - 40 * DAY) } },
    );
    const report = await retainTrash(a.mongo, a.core(), a.id);
    expect(report).toEqual({ entries: 1, removed: 1, failed: 0 });
    expect((await a.trashed()).map((n) => n.name)).toEqual(["new.txt"]);
    expect(await a.usage()).toMatchObject({ bytes: 3, trashBytes: 3 });
  });

  test("the workspace's trashDays decides, and a run may override it", async () => {
    const a = await trashArea(files);
    const file = await files.addFile(
      a.owner,
      a.id,
      a.root.id,
      "a.txt",
      "alpha",
    );
    await a.trash([file]);
    await a.mongo.db.nodes.raw.updateOne(
      { name: "a.txt" },
      { $set: { trashedAt: new Date(Date.now() - 5 * DAY) } },
    );
    expect(await retainTrash(a.mongo, a.core(), a.id)).toEqual({
      entries: 0,
      removed: 0,
      failed: 0,
    });
    await updateSettings(a.core(), a.id, { trashDays: 3 });
    expect(await retainTrash(a.mongo, a.core(), a.id)).toEqual({
      entries: 1,
      removed: 1,
      failed: 0,
    });
  });

  test("retainTrashAll settles every workspace", async () => {
    const a = await trashArea(files);
    const file = await files.addFile(
      a.owner,
      a.id,
      a.root.id,
      "a.txt",
      "alpha",
    );
    await a.trash([file]);
    const all = await retainTrashAll(a.core(), (id) => store.databaseOf(id), {
      days: 0,
      now: () => new Date(Date.now() + DAY),
    });
    expect(all.failed).toEqual([]);
    expect(all.done.find((d) => d.workspaceId === a.id)).toMatchObject({
      entries: 1,
    });
  });
});
