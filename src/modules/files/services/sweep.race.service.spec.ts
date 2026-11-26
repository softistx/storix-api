import { describe, expect, spyOn, test } from "bun:test";
import { Collection } from "mongodb";
import { filesWorld } from "../../../../test/files.harness";
import type { SweepBucket } from "./index";
import { area as areaOf, later } from "./sweep.harness";

// The sweep against a concurrent addFile, on a real S3 API and the real Mongo.
const files = filesWorld();
const area = () => areaOf(files);

describe("the sweep against addFile", () => {
  test("a key recorded between the sweep's check and its claim is never removed", async () => {
    const a = await area();
    const up = await a.upload("raced");
    let recorded: Awaited<ReturnType<typeof a.record>> | undefined;
    const original = Collection.prototype.insertOne;
    // The interleaving is forced: right before the sweep claims the key, a
    // whole addFile of it commits. The claim then conflicts and the object stays.
    const spy = spyOn(Collection.prototype, "insertOne").mockImplementation(
      async function (this: Collection, ...args: never[]) {
        const doc = (args as unknown[])[0] as { refs?: number };
        if (this.collectionName === "blobs" && doc.refs === 0 && !recorded) {
          recorded = await a.record(up.key, "raced.txt");
        }
        return original.apply(this, args as never);
      } as never,
    );
    try {
      await a.sweep({ now: later });
    } finally {
      spy.mockRestore();
    }
    expect(recorded?.errors).toBeUndefined();
    expect(await a.keys()).toEqual([a.place(up.key)]);
    expect(await a.mongo.db.blobs.findFirst({ key: up.key })).toMatchObject({
      refs: 2,
    });
  });

  test("an addFile that arrives while the sweep removes the object is refused, never half recorded", async () => {
    const a = await area();
    const up = await a.upload("late");
    let recorded: Awaited<ReturnType<typeof a.record>> | undefined;
    const racing: SweepBucket = {
      list: (...args) => a.bucket.list(...args),
      delete: async (...args) => {
        recorded ??= await a.record(up.key, "late.txt");
        return a.bucket.delete(...args);
      },
    };
    await a.sweep({ now: later }, racing);
    const code = (
      recorded?.errors?.[0]?.extensions as { code?: string } | undefined
    )?.code;
    expect(code).toBe("files.errors.key-unknown");
    expect(await a.keys()).toEqual([]);
    // Only the sweep's own claim remains, never a held blob.
    expect(await a.mongo.db.blobs.findFirst({ key: up.key })).toMatchObject({
      refs: 0,
    });
    expect(
      await a.mongo.db.nodes.findFirst({ blobKey: up.key }),
    ).toBeUndefined();
  });

  test("an addFile that opened the object before the sweep removed it is refused after the sweep", async () => {
    const a = await area();
    const up = await a.upload("gap");
    const original = files.ctx.bucket.open.bind(files.ctx.bucket);
    let swept = false;
    // The gap: addFile has opened the object (it exists), then a whole sweep
    // claims it, removes it and finishes, before addFile's transaction.
    const spy = spyOn(files.ctx.bucket, "open").mockImplementation((async (
      ...args: Parameters<typeof original>
    ) => {
      const opened = await original(...args);
      if (!swept) {
        swept = true;
        await a.sweep({ now: later });
      }
      return opened;
    }) as never);
    let recorded: Awaited<ReturnType<typeof a.record>>;
    try {
      recorded = await a.record(up.key, "gap.txt");
    } finally {
      spy.mockRestore();
    }
    const code = (
      recorded.errors?.[0]?.extensions as { code?: string } | undefined
    )?.code;
    expect(code).toBe("files.errors.key-unknown");
    expect(await a.keys()).toEqual([]);
    expect(
      await a.mongo.db.nodes.findFirst({ blobKey: up.key }),
    ).toBeUndefined();
  });
});
