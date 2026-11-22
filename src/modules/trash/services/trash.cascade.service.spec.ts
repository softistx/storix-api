import { describe, expect, test } from "bun:test";
import { fileReader } from "@/modules/files/public";
import { filesWorld } from "../../../../test/files.harness";
import { codeOf, trashArea } from "../../../../test/trash.harness";

const files = filesWorld();

// A folder with a file and a subfolder holding a second file.
async function tree(a: Awaited<ReturnType<typeof trashArea>>) {
  const docs = await a.folder(a.root.id, "docs");
  const deep = await a.folder(docs.id, "deep");
  const top = await files.addFile(a.owner, a.id, docs.id, "top.txt", "top");
  const low = await files.addFile(a.owner, a.id, deep.id, "low.txt", "lower");
  return { docs, deep, top, low };
}

describe("trashNodes", () => {
  test("a subtree of more than 5,000 nodes is refused, and stays live", async () => {
    const a = await trashArea(files);
    const big = await a.folder(a.root.id, "big");
    const parent = await a.mongo.db.nodes.getById(big.id);
    const owner = a.owner.principal.accountId;
    await a.mongo.db.nodes.as(owner).createMany(
      Array.from({ length: 5001 }, (_, i) => ({
        type: "FOLDER" as const,
        name: `n${i}`,
        parentId: parent._id,
        ancestors: [...parent.ancestors, parent._id],
        ownerId: owner,
      })),
    );
    expect(codeOf(await a.trash([big]))).toBe("nodes.errors.move-too-large");
    expect(await a.names(a.root.id)).toEqual(["big"]);
  });

  test("a trashed folder takes its subtree out of every read", async () => {
    const a = await trashArea(files);
    const { docs, deep, top, low } = await tree(a);
    const result = await a.trash([docs]);
    expect(result.errors).toBeUndefined();
    const out = (result.data?.["trashNodes"] ?? []) as {
      id: string;
      trashedAt: string;
      trashedBy: string;
    }[];
    expect(out.map((n) => n.id)).toEqual([docs.id]);
    expect(out[0]?.trashedBy).toBe(a.owner.principal.accountId);
    expect(await a.children(a.root.id)).toEqual([]);
    expect(await a.names(a.root.id)).toEqual([]);
    for (const id of [docs.id, deep.id, top.id, low.id]) {
      expect(codeOf(await a.one(id))).toBe("nodes.errors.not-found");
    }
    expect(codeOf(await a.versionsOf(low.id))).toBe("nodes.errors.not-found");
    for (const file of [top, low]) {
      expect(
        await fileReader(a.mongo, {
          key: file.key,
          accountId: a.owner.principal.accountId,
        }),
      ).toBe(false);
    }
  });

  test("only the top node is an entry of the trash", async () => {
    const a = await trashArea(files);
    const { docs, deep } = await tree(a);
    await a.trash([deep]);
    await a.trash([docs]);
    const entries = (await a.trashed()).map((n) => n.name).sort();
    expect(entries).toEqual(["deep", "docs"]);
    const below = await a.mongo.db.nodes.findFirst({ name: "top.txt" });
    expect(below?.trashRootId?.toHexString()).toBe(docs.id);
    const nested = await a.mongo.db.nodes.findFirst({ name: "deep" });
    expect(nested?.trashRootId).toBeNull();
  });

  test("a selected node under another selected node goes with it", async () => {
    const a = await trashArea(files);
    const { docs, deep } = await tree(a);
    const result = await a.trash([docs, deep]);
    const out = (result.data?.["trashNodes"] ?? []) as { id: string }[];
    expect(out.map((n) => n.id)).toEqual([docs.id]);
  });

  test("a root, a trashed node and a stranger's node are refused", async () => {
    const a = await trashArea(files);
    const { docs } = await tree(a);
    expect(codeOf(await a.trash([a.root]))).toBe("nodes.errors.root-locked");
    await a.trash([docs]);
    expect(codeOf(await a.trash([docs]))).toBe("nodes.errors.not-found");
    expect(codeOf(await a.trash([{ id: "nope" }]))).toBe(
      "nodes.errors.not-found",
    );
  });

  test("a trashed name is free again for a new node", async () => {
    const a = await trashArea(files);
    const { docs } = await tree(a);
    await a.trash([docs]);
    const again = await a.folder(a.root.id, "docs");
    expect(again.id).not.toBe(docs.id);
  });
});
