import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import { workspacesMongo } from "@/core/workspaces";
import { areaOf } from "../../../../test/files.area";
import { filesWorld } from "../../../../test/files.harness";
import { versionsArea } from "../../../../test/versions.harness";
import { filesMongo } from "../models";
import { copyNodes } from "./index";

const files = filesWorld();

describe("cropsStatus across a copy and a new version", () => {
  test("a copy carries the crops status and its heartbeat over", async () => {
    const a = await areaOf(files);
    const file = await a.file(a.root.id, "pic.png");
    const dest = await a.owner.folder(a.root.id, "dest");
    const mongo = filesMongo(await store.databaseOf(a.workspace.id));
    await mongo.db.nodes.raw.updateMany(
      { blobKey: file.key },
      { $set: { cropsStatus: "PROCESSING" } },
    );
    await copyNodes(
      mongo,
      workspacesMongo(store.core),
      {
        ids: [file.id],
        parentId: dest.id,
        accountId: a.workspace.owner.principal.accountId,
        workspaceId: a.workspace.id,
      },
      { maxNodes: 100, maxDepth: 16 },
    );
    const copied = await mongo.db.nodes.findFirst({ parentId: dest.id });
    expect(copied).toMatchObject({ cropsStatus: "PROCESSING" });
    expect(copied?.renditionsAt).toBeInstanceOf(Date);
  });

  test("a new version resets the crops status", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "one");
    await a.mongo.db.nodes.raw.updateMany(
      { blobKey: file.key },
      { $set: { cropsStatus: "FAILED" } },
    );
    const { result } = await a.push(file.id, "twenty");
    expect(result.errors).toBeUndefined();
    expect(await a.mongo.db.nodes.findFirst({ name: "a.txt" })).toMatchObject({
      cropsStatus: null,
    });
  });
});
