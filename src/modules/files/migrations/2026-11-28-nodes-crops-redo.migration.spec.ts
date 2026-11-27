import { describe, expect, test } from "bun:test";
import { connection } from "@/config/db";
import { nodesCropsRedo } from "./2026-11-28-nodes-crops-redo.migration";

describe("the crops redo migration", () => {
  const context = (database: ReturnType<typeof connection.client.db>) => ({
    db: database,
    client: connection.client,
    session: undefined,
  });

  test("marks the crops of a node with a focal point pending, and leaves the others", async () => {
    const empty = connection.client.db("storix_crops_redo_empty");
    await nodesCropsRedo.up(context(empty));
    expect(await empty.listCollections({ name: "nodes" }).toArray()).toEqual(
      [],
    );

    const database = connection.client.db("storix_crops_redo");
    const nodes = database.collection("nodes");
    await nodes.insertMany([
      {
        _id: "moved" as never,
        blobKey: "k1",
        focalPoint: { x: 0.2, y: 0.5 },
        cropsStatus: "READY",
        trashedAt: null,
      },
      {
        _id: "centre" as never,
        blobKey: "k2",
        focalPoint: null,
        trashedAt: null,
      },
    ]);
    await nodesCropsRedo.up(context(database));
    expect(await nodes.findOne({ _id: "moved" as never })).toMatchObject({
      cropsStatus: "PROCESSING",
      renditionRequeues: 0,
    });
    expect(await nodes.findOne({ _id: "centre" as never })).not.toHaveProperty(
      "cropsStatus",
    );
  });
});
