import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { store } from "@/config/tenancy";
import { filesWorld } from "../../../test/files.harness";
import { NODE, setup } from "../nodes/nodes.harness";
import { filesMongo } from "./models";
import { MAX_READS } from "./services";

const files = filesWorld();

const STARRED = `query($first: Int, $after: String) { starred(first: $first, after: $after) { nodes { ${NODE} } pageInfo { endCursor hasNextPage } } }`;

interface Page {
  nodes: { id: string }[];
  pageInfo: { endCursor: string | null; hasNextPage: boolean };
}

describe("favourites buried under dead rows", () => {
  test("an empty page can say hasNextPage, and the cursor goes on", async () => {
    const s = await setup(files.ctx.w);
    const { owner, id } = s.workspace;
    const db = filesMongo(await store.databaseOf(id));
    const accountId = owner.principal.accountId;
    const root = await s.owner.root();
    const live = await files.addFile(owner, id, root.id, "live.txt");
    // Older than every dead row below: the first page cannot reach it.
    await db.db.stars.upsert(
      { accountId, nodeId: new ObjectId(live.id) as never },
      {},
    );
    await db.db.stars.raw.updateMany(
      { nodeId: new ObjectId(live.id) },
      { $set: { createdAt: new Date(1_000) } },
    );
    const dead = MAX_READS * 100 + 5;
    await db.db.stars.raw.insertMany(
      Array.from({ length: dead }, (_, index) => ({
        _id: new ObjectId(),
        accountId,
        nodeId: new ObjectId(),
        createdAt: new Date(1_000_000 + index),
        updatedAt: new Date(1_000_000 + index),
      })),
    );
    const first = await s.w.send(owner, STARRED, {
      ...s.at,
      variables: { first: 10 },
    });
    expect(first.errors).toBeUndefined();
    const page = first.data?.["starred"] as Page;
    expect(page.nodes).toEqual([]);
    expect(page.pageInfo.hasNextPage).toBe(true);
    const next = await s.w.send(owner, STARRED, {
      ...s.at,
      variables: { first: 10, after: page.pageInfo.endCursor },
    });
    const rest = next.data?.["starred"] as Page;
    expect(rest.nodes.map((n) => n.id)).toEqual([live.id]);
    expect(rest.pageInfo.hasNextPage).toBe(false);
  });
});
