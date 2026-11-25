import { afterEach, describe, expect, test } from "bun:test";
import { actionsOf, storedEvents } from "@/core/audit/audit.harness";
import { failDeleteOn } from "../../../../test/fail-delete";
import { filesWorld } from "../../../../test/files.harness";
import { trashArea } from "../../../../test/trash.harness";

const files = filesWorld();

let spy: ReturnType<typeof failDeleteOn> | undefined;
afterEach(() => {
  spy?.mockRestore();
  spy = undefined;
});

describe("the purge audit", () => {
  test("purgeNodes records node.purge per entry, with its parent", async () => {
    const a = await trashArea(files);
    const docs = await a.folder(a.root.id, "docs");
    const inner = await files.addFile(a.owner, a.id, docs.id, "a.txt", "alpha");
    await a.trash([inner]);
    expect((await a.purge([inner])).errors).toBeUndefined();
    const events = (await storedEvents(a.id)).filter(
      (e) => e.action === "node.purge",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      target: { type: "FILE", id: inner.id, name: "a.txt" },
      meta: { parentId: docs.id },
    });
  });

  test("emptyTrash records one trash.empty with the entries and nodes", async () => {
    const a = await trashArea(files);
    const docs = await a.folder(a.root.id, "docs");
    const inner = await files.addFile(a.owner, a.id, docs.id, "a.txt", "alpha");
    const loose = await files.addFile(
      a.owner,
      a.id,
      a.root.id,
      "b.txt",
      "bravo",
    );
    await a.trash([docs, loose]);
    expect((await a.empty()).errors).toBeUndefined();
    const empties = (await storedEvents(a.id)).filter(
      (e) => e.action === "trash.empty",
    );
    expect(empties).toHaveLength(1);
    expect(empties[0]).toMatchObject({
      target: { type: "TRASH", id: a.owner.principal.accountId },
      meta: { entries: 2, nodes: 3 },
    });
    expect(inner.id).toBeTruthy();
  });
});

describe("a purge that fails partway", () => {
  test("purgeNodes keeps what went, audits it and leaves the rest in the trash", async () => {
    const a = await trashArea(files);
    const one = await files.addFile(a.owner, a.id, a.root.id, "a.txt", "alpha");
    const two = await files.addFile(a.owner, a.id, a.root.id, "b.txt", "bravo");
    await a.trash([one]);
    await a.trash([two]);
    spy = failDeleteOn("nodes", 2, a.id);
    const result = await a.purge([one, two]);
    spy.mockRestore();
    expect(result.errors).toBeDefined();
    const left = await a.trashed();
    expect(left).toHaveLength(1);
    const events = (await storedEvents(a.id)).filter(
      (e) => e.action === "node.purge",
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.target?.id).not.toBe(left[0]?.id);
    // The quota follows the one entry that went, and the next call finishes.
    expect(await a.usage()).toMatchObject({ trashBytes: 5 });
    expect((await a.empty()).errors).toBeUndefined();
    expect(await a.trashed()).toEqual([]);
    expect(await a.usage()).toMatchObject({ bytes: 0, trashBytes: 0 });
  });

  test("emptyTrash records trash.empty for the entries purged before the failure", async () => {
    const a = await trashArea(files);
    const one = await files.addFile(a.owner, a.id, a.root.id, "a.txt", "alpha");
    const two = await files.addFile(a.owner, a.id, a.root.id, "b.txt", "bravo");
    await a.trash([one]);
    await a.trash([two]);
    spy = failDeleteOn("nodes", 2, a.id);
    const result = await a.empty();
    spy.mockRestore();
    expect(result.errors).toBeDefined();
    expect(await a.trashed()).toHaveLength(1);
    const events = await storedEvents(a.id);
    expect(actionsOf(events).filter((x) => x === "trash.empty")).toHaveLength(
      1,
    );
    expect(events.find((e) => e.action === "trash.empty")?.meta).toEqual({
      entries: 1,
      nodes: 1,
    });
  });
});
