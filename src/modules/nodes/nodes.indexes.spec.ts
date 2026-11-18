import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { connection } from "@/config/db";
import { env } from "@/config/env";
import { store } from "@/config/tenancy";
import { nodesListingDescIndexes } from "../files/migrations/2026-11-24-nodes-listing-desc-indexes.migration";
import { nodesListingCollation } from "./migrations/2026-11-15-nodes-listing-collation.migration";
import { nodesMongo } from "./nodes.handle";
import { setup } from "./nodes.harness";

const WORKSPACE_DB = (id: string) => `${env.MONGO_WORKSPACE_PREFIX}${id}`;

const LISTING = ["nodes_listing", "nodes_listing_size", "nodes_listing_kind"];

// The stages of the winning plan, innermost last.
function stages(plan: Record<string, unknown> | undefined): string[] {
  const out: string[] = [];
  for (let node = plan; node; ) {
    out.push(String(node["stage"]));
    node = (node["inputStage"] ?? undefined) as typeof plan;
    if (out.length > 10) break;
  }
  return out;
}

describe("the listing indexes", () => {
  test("sorting a folder by name, date, size or kind, either way, reads an index, no sort in memory", async () => {
    const { workspace, owner } = await setup();
    const root = await owner.root();
    const db = nodesMongo(await store.databaseOf(workspace.id));
    const now = new Date();
    const docs = Array.from({ length: 80 }, (_, i) => ({
      _id: new ObjectId(),
      type: i % 8 === 0 ? "FOLDER" : "FILE",
      name: i % 2 ? `file-${i}` : `File-${i}`,
      parentId: new ObjectId(root.id),
      ancestors: [new ObjectId(root.id)],
      ownerId: workspace.owner.principal.accountId,
      spaceId: null,
      trashedAt: null,
      size: i,
      family: i % 3 ? "IMAGE" : "PDF",
      createdAt: now,
      updatedAt: now,
    }));
    await db.db.nodes.raw.insertMany(docs as never, {
      bypassDocumentValidation: true,
    });

    // Every sort of the listing (`nodes.list.ts`), both directions, folders
    // first: each reads an index and sorts nothing in memory.
    const sorts = [1, -1].flatMap((d) => [
      { type: -1, name: d, _id: d },
      { type: -1, updatedAt: d, _id: d },
      { type: -1, size: d, name: d, _id: d },
      { type: -1, family: d, name: d, _id: d },
    ]);
    for (const sort of sorts) {
      const explained = (await db.db.nodes.raw
        .find({ $and: [{ parentId: new ObjectId(root.id), trashedAt: null }] })
        .sort(sort as never)
        .collation({ locale: "en", strength: 2 })
        .explain("queryPlanner")) as {
        queryPlanner: { winningPlan: Record<string, unknown> };
      };
      const names = stages(explained.queryPlanner.winningPlan);
      expect(names, JSON.stringify(sort)).toContain("IXSCAN");
      expect(names, JSON.stringify(sort)).not.toContain("SORT");
    }
  });

  test("the migration rebuilds an index that has no collation, and leaves a good one", async () => {
    const { workspace } = await setup();
    const database = connection.client.db(WORKSPACE_DB(workspace.id));
    const nodes = database.collection("nodes");
    for (const name of LISTING) await nodes.dropIndex(name);
    await nodes.createIndex(
      { parentId: 1, type: 1, name: 1, _id: 1 },
      { name: "nodes_listing" },
    );
    await nodes.createIndex(
      { parentId: 1, type: -1, size: 1, name: 1, _id: 1 },
      { name: "nodes_listing_size" },
    );
    const context = {
      db: database,
      client: connection.client,
      session: undefined,
    };
    await nodesListingCollation.up(context);
    const built = await nodes.indexes();
    for (const name of LISTING) {
      const index = built.find((i) => i.name === name);
      expect(index?.collation?.["locale"], name).toBe("en");
      expect(index?.collation?.["strength"], name).toBe(2);
    }
    expect(built.find((i) => i.name === "nodes_listing")?.key).toEqual({
      parentId: 1,
      type: -1,
      name: 1,
      _id: 1,
    });
    // A second run changes nothing: no index is dropped and built again.
    const before = JSON.stringify(built);
    await nodesListingCollation.up(context);
    expect(JSON.stringify(await nodes.indexes())).toBe(before);
  });

  test("the desc-indexes migration rebuilds the date index with its collation, adds the twins, and is idempotent", async () => {
    const { workspace } = await setup();
    const database = connection.client.db(WORKSPACE_DB(workspace.id));
    const nodes = database.collection("nodes");
    const names = [
      "nodes_listing_date",
      "nodes_listing_desc",
      "nodes_listing_date_desc",
      "nodes_listing_size_desc",
      "nodes_listing_kind_desc",
      "nodes_processing",
    ];
    for (const name of names) await nodes.dropIndex(name);
    await nodes.createIndex(
      { parentId: 1, type: -1, updatedAt: 1, _id: 1 },
      { name: "nodes_listing_date" },
    );
    const context = {
      db: database,
      client: connection.client,
      session: undefined,
    };
    await nodesListingDescIndexes.up(context);
    const built = await nodes.indexes();
    for (const name of names) {
      const index = built.find((i) => i.name === name);
      expect(index, name).toBeDefined();
      if (name !== "nodes_processing") {
        expect(index?.collation?.["locale"], name).toBe("en");
      }
    }
    const before = JSON.stringify(built);
    await nodesListingDescIndexes.up(context);
    expect(JSON.stringify(await nodes.indexes())).toBe(before);
  });
});
