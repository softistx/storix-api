import { describe, expect, spyOn, test } from "bun:test";
import { mediaPlace, newMediaKey } from "@softistx/alxia-media";
import { Collection } from "mongodb";
import { store } from "@/config/tenancy";
import { ADD, filesWorld } from "../../../test/files.harness";
import { setup } from "../nodes/nodes.harness";
import { filesMongo } from "./files.handle";
import { recountStorage } from "./files.recount";
import { sweepWorkspace } from "./files.sweep";
import type { SweepBucket } from "./files.sweep.run";

// The orphan sweep against a real S3 API and the real Mongo: released blobs
// with their sizes, objects nobody recorded once they are old enough, and a
// recorded object that no interleaving can remove.
const files = filesWorld();
const HOUR = 60 * 60_000;
const later = () => new Date(Date.now() + 2 * HOUR);

const databaseOf = async (id: string) => filesMongo(await store.databaseOf(id));

async function area() {
  const s = await setup(files.ctx.w);
  const { id, owner } = s.workspace;
  const root = await s.owner.root();
  const mongo = await databaseOf(id);
  const place = mediaPlace("files", `workspaces/${id}`);
  const bucket = files.ctx.bucket as SweepBucket;
  const keys = async () =>
    (
      await bucket.list({ prefix: `workspaces/${id}/files/`, limit: 1000 })
    ).items
      .map((item) => item.key)
      .sort();
  // An object nobody recorded, as a /media PUT that `addFile` never saw.
  const stray = async (key = newMediaKey(), sizes: string[] = []) => {
    for (const name of ["", ...sizes.map((size) => `/${size}`)]) {
      await files.ctx.bucket.put({ key: place(key) + name }, "x", {
        type: "text/plain",
      });
    }
    return key;
  };
  const record = (key: string, name: string) =>
    s.w.send(owner, ADD, {
      workspace: id,
      variables: { input: { key, name, parentId: root.id } },
    });
  const upload = (body: string) => files.upload(owner, id, body);
  const sweep = (over = {}, on: SweepBucket = bucket) =>
    sweepWorkspace(mongo, on, id, { log: () => {}, ...over });
  return {
    ...s,
    id,
    owner,
    root,
    mongo,
    place,
    keys,
    stray,
    record,
    upload,
    sweep,
    bucket,
  };
}

describe("the orphan sweep", () => {
  test("a released blob goes with its object and its sizes", async () => {
    const a = await area();
    const key = await a.stray(undefined, ["thumb", "preview"]);
    await a.mongo.db.blobs.create({
      key,
      size: 1,
      mimeType: "text/plain",
      refs: 0,
    });
    const report = await a.sweep();
    expect(report).toMatchObject({ released: 1, failed: 0 });
    expect(await a.keys()).toEqual([]);
    expect(await a.mongo.db.blobs.findFirst({ key })).toBeUndefined();
  });

  test("a blob that is still referenced is kept, however old", async () => {
    const a = await area();
    const up = await a.upload("kept");
    expect((await a.record(up.key, "kept.txt")).errors).toBeUndefined();
    const report = await a.sweep({ now: later });
    expect(report).toEqual({ released: 0, orphans: 0, failed: 0 });
    expect(await a.keys()).toEqual([a.place(up.key)]);
  });

  test("an unrecorded object is kept until it is 75 minutes old, then removed with its sizes", async () => {
    const a = await area();
    const kept = await a.upload("recorded");
    await a.record(kept.key, "recorded.txt");
    const orphan = await a.stray(undefined, ["thumb"]);
    expect((await a.sweep()).orphans).toBe(0);
    expect(await a.keys()).toHaveLength(3);
    const report = await a.sweep({ now: later });
    expect(report).toMatchObject({ orphans: 2, failed: 0 });
    expect(await a.keys()).toEqual([a.place(kept.key)]);
    // The claim is lifted: the key is not recorded and not held.
    expect(await a.mongo.db.blobs.findFirst({ key: orphan })).toBeUndefined();
  });

  test("it leaves usage equal to a recount", async () => {
    const a = await area();
    const up = await a.upload("counted");
    await a.record(up.key, "counted.txt");
    await a.stray();
    const stored = async () =>
      (await store.core.db.workspaces.getById(a.id)).usage;
    const before = await stored();
    await a.sweep({ now: later });
    const after = await stored();
    expect(after).toEqual(before);
    const recount = await recountStorage(a.mongo);
    expect({
      bytes: after.bytes,
      files: after.files,
      versionBytes: after.versionBytes,
      trashBytes: after.trashBytes,
    }).toEqual(recount);
  });

  test("a failed delete is logged, counted and retried by the next run", async () => {
    const a = await area();
    const orphan = await a.stray();
    const logs: string[] = [];
    let broken = true;
    const flaky: SweepBucket = {
      list: (...args) => a.bucket.list(...args),
      delete: (...args) =>
        broken ? Promise.reject(new Error("down")) : a.bucket.delete(...args),
    };
    const first = await a.sweep(
      { now: later, log: (m: string) => logs.push(m) },
      flaky,
    );
    expect(first).toMatchObject({ orphans: 0, failed: 1 });
    expect(logs.some((m) => m.includes(orphan))).toBe(true);
    broken = false;
    expect(await a.sweep({ now: later }, flaky)).toMatchObject({
      orphans: 1,
      failed: 0,
    });
    expect(await a.keys()).toEqual([]);
  });

  test("the brake: ten old keys and no blob at all are not swept", async () => {
    const a = await area();
    for (let i = 0; i < 10; i++) await a.stray();
    const logs: string[] = [];
    const report = await a.sweep({
      now: later,
      log: (m: string) => logs.push(m),
    });
    expect(report.orphans).toBe(0);
    expect(await a.keys()).toHaveLength(10);
    expect(logs.some((m) => m.includes("stopped"))).toBe(true);
  });
});

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
    expect(await a.mongo.db.blobs.findFirst({ key: up.key })).toBeUndefined();
    expect(
      await a.mongo.db.nodes.findFirst({ blobKey: up.key }),
    ).toBeUndefined();
  });
});
