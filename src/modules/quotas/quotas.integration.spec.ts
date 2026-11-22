import { describe, expect, test } from "bun:test";
import { S3Client } from "bun";
import { connection } from "@/config/db";
import { env } from "@/config/env";
import { store } from "@/config/tenancy";
import { setQuota, workspacesMongo } from "@/core/workspaces";
import { workspacesQuota } from "@/core/workspaces/migrations/2026-11-20-workspaces-quota.migration";
import { ADD, BUCKET, COPY, filesWorld } from "../../../test/files.harness";
import { filesMongo, recountStorage } from "../files/public";
import { setup } from "../nodes/nodes.harness";
import { reconcileAll, reconcileUsage } from "./public";

const files = filesWorld();

const core = () => workspacesMongo(store.core);
const databaseOf = async (id: string) => filesMongo(await store.databaseOf(id));

const code = (r: {
  errors?: readonly { extensions?: unknown }[] | undefined;
}) => (r.errors?.[0]?.extensions as { code?: string } | undefined)?.code;

async function objects() {
  const s3 = new S3Client({
    bucket: BUCKET,
    endpoint: files.ctx.s3.endpoint,
    accessKeyId: files.ctx.s3.accessKeyId,
    secretAccessKey: files.ctx.s3.secretAccessKey,
    region: files.ctx.s3.region,
  });
  return (await s3.list({ maxKeys: 1000 })).contents?.length ?? 0;
}

const STORAGE = `{ storage { quotaBytes usedBytes currentBytes versionBytes trashBytes files } }`;

async function area() {
  const s = await setup(files.ctx.w);
  const root = await s.owner.root();
  const { owner, id, slug } = s.workspace;
  const send = (query: string, variables?: Record<string, unknown>) =>
    s.w.send(owner, query, {
      ...s.at,
      ...(variables && { variables }),
    });
  const storage = async () =>
    (await send(STORAGE)).data?.["storage"] as Record<string, number>;
  const stored = async () => {
    const doc = await core().db.workspaces.getById(id);
    return doc.usage;
  };
  return { ...s, root, send, storage, stored, user: owner, id, slug };
}

describe("the quota of a workspace", () => {
  test("a new workspace has 10 GiB and nothing used", async () => {
    const { storage } = await area();
    expect(await storage()).toEqual({
      quotaBytes: 10 * 1024 ** 3,
      usedBytes: 0,
      currentBytes: 0,
      versionBytes: 0,
      trashBytes: 0,
      files: 0,
    });
  });

  test("an upload over the quota is refused before the body is read and leaves no object", async () => {
    const { user, id, slug } = await area();
    expect(await setQuota(core(), slug, 100)).toBe(true);
    const before = await objects();
    // A body that is never pulled: the refusal comes from the declared length.
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true;
          controller.enqueue(new TextEncoder().encode("x".repeat(101)));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const res = await files.call(user, id, "/media/files", {
      method: "PUT",
      body: stream,
      headers: { "content-type": "text/plain", "content-length": "101" },
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
    const body = (await res.json()) as {
      errors: { extensions: { code: string } }[];
    };
    expect(body.errors[0]?.extensions.code).toBe("quotas.errors.exceeded");
    expect(pulled).toBe(false);
    expect(await objects()).toBe(before);
    // An upload that fits is taken.
    const ok = await files.upload(user, id, "x".repeat(100));
    expect(ok.size).toBe(100);
  });

  test("addFile decides: a file that no longer fits is refused, leaves no node, no blob and no object", async () => {
    const { user, id, slug, root, send, stored } = await area();
    const up = await files.upload(user, id, "y".repeat(60));
    const second = await files.upload(user, id, "z".repeat(60));
    expect(await setQuota(core(), slug, 100)).toBe(true);
    const first = await send(ADD, {
      input: { key: up.key, name: "a.txt", parentId: root.id },
    });
    expect(first.errors).toBeUndefined();
    const before = await objects();
    const refused = await send(ADD, {
      input: { key: second.key, name: "b.txt", parentId: root.id },
    });
    expect(code(refused)).toBe("quotas.errors.exceeded");
    expect(refused.response.status).toBe(413);
    expect(await objects()).toBe(before - 1);
    const db = await databaseOf(id);
    expect(await db.db.blobs.findFirst({ key: second.key })).toBeUndefined();
    expect(
      await db.db.nodes.findFirst({ blobKey: second.key }),
    ).toBeUndefined();
    expect(await stored()).toMatchObject({ bytes: 60, files: 1 });
    // The refusal is in the audit log.
    const log = await send(`{ auditEvents(first: 10) { nodes { action } } }`);
    expect(
      ((log.data?.["auditEvents"]?.nodes ?? []) as { action: string }[]).map(
        (e) => e.action,
      ),
    ).toContain("quota.exceeded");
  });

  test("two uploads racing for the last bytes: one wins, the counter never passes the quota", async () => {
    const { user, id, slug, root, send, stored } = await area();
    const a = await files.upload(user, id, "a".repeat(70));
    const b = await files.upload(user, id, "b".repeat(70));
    await setQuota(core(), slug, 100);
    const results = await Promise.all(
      [a, b].map((up, i) =>
        send(ADD, {
          input: { key: up.key, name: `r${i}.txt`, parentId: root.id },
        }),
      ),
    );
    expect(results.filter((r) => !r.errors)).toHaveLength(1);
    expect(
      results.filter((r) => code(r) === "quotas.errors.exceeded"),
    ).toHaveLength(1);
    expect(await stored()).toMatchObject({ bytes: 70, files: 1 });
  });

  test("counters equal a recount after a mixed run: add, copy of shared blobs, a refusal", async () => {
    const { user, id, slug, root, send, storage, stored, folder } =
      await area().then(async (a) => ({
        ...a,
        folder: (name: string) => a.owner.folder(a.root.id, name),
      }));
    const one = await files.addFile(
      user,
      id,
      root.id,
      "one.txt",
      "1".repeat(10),
    );
    const two = await files.addFile(
      user,
      id,
      root.id,
      "two.txt",
      "2".repeat(25),
    );
    const dir = await folder("docs");
    await files.addFile(user, id, dir.id, "three.txt", "3".repeat(5));
    // A copy shares the blob: no byte more, one more file per copy.
    const copied = await send(COPY, {
      ids: [one.id, dir.id],
      parentId: root.id,
    });
    expect(copied.errors).toBeUndefined();
    const again = await send(COPY, { ids: [two.id], parentId: dir.id });
    expect(again.errors).toBeUndefined();
    expect(await stored()).toMatchObject({ bytes: 40, files: 6 });
    expect(await storage()).toMatchObject({
      usedBytes: 40,
      currentBytes: 40,
      files: 6,
    });
    // A refused upload changes nothing.
    const big = await files.upload(user, id, "9".repeat(10));
    await setQuota(core(), slug, 45);
    const refused = await send(ADD, {
      input: { key: big.key, name: "big.txt", parentId: root.id },
    });
    expect(code(refused)).toBe("quotas.errors.exceeded");
    const db = await databaseOf(id);
    const recount = await recountStorage(db);
    expect(recount).toEqual({
      bytes: 40,
      files: 6,
      versionBytes: 0,
      trashBytes: 0,
    });
    const usage = await stored();
    expect({
      bytes: usage.bytes,
      files: usage.files,
      versionBytes: usage.versionBytes,
      trashBytes: usage.trashBytes,
    }).toEqual(recount);
  });

  test("reconcile corrects a drifted counter and leaves a right one alone", async () => {
    const { user, id, root, stored } = await area();
    await files.addFile(user, id, root.id, "a.txt", "a".repeat(12));
    const db = await databaseOf(id);
    const fine = await reconcileUsage(db, core(), id);
    expect(fine).toMatchObject({
      drift: false,
      after: { bytes: 12, files: 1 },
    });
    await core().db.workspaces.raw.updateOne(
      { slug: (await core().db.workspaces.getById(id)).slug },
      { $set: { "usage.bytes": 999, "usage.files": 7 } },
    );
    const fixed = await reconcileUsage(db, core(), id);
    expect(fixed).toMatchObject({
      drift: true,
      before: { bytes: 999, files: 7 },
      after: { bytes: 12, files: 1 },
    });
    expect(await stored()).toMatchObject({ bytes: 12, files: 1 });
    const all = await reconcileAll(core(), (wid) => store.databaseOf(wid));
    expect(all.failed).toEqual([]);
    expect(all.done.some((r) => r.workspaceId === id && !r.drift)).toBe(true);
  });

  test("a workspace stored before the quota existed reads the default, and the migration makes it valid", async () => {
    const { user, id, root, stored, storage } = await area();
    const raw = connection.client
      .db(env.MONGO_CORE_DATABASE)
      .collection("workspaces");
    const _id = (await core().db.workspaces.getById(id))._id;
    await raw.updateOne(
      { _id },
      { $unset: { quotaBytes: "", usage: "" } },
      { bypassDocumentValidation: true },
    );
    expect((await storage())["quotaBytes"]).toBe(10 * 1024 ** 3);
    await workspacesQuota.up({
      db: connection.client.db(env.MONGO_CORE_DATABASE),
    } as never);
    expect(await raw.findOne({ _id })).toMatchObject({
      quotaBytes: 10 * 1024 ** 3,
      usage: { bytes: 0, files: 0, versionBytes: 0, trashBytes: 0 },
    });
    await files.addFile(user, id, root.id, "old.txt", "o".repeat(8));
    expect(await stored()).toMatchObject({ bytes: 8, files: 1 });
  });

  test("any member reads storage; no workspace header is refused", async () => {
    const a = await area();
    const { user: member } = await a.w.join(
      { id: a.id, owner: a.user },
      "MEMBER",
    );
    const res = await a.w.send(member, STORAGE, a.at);
    expect(res.errors).toBeUndefined();
    const none = await a.w.send(a.user, STORAGE);
    expect(code(none)).toBe("workspaces.errors.workspace-required");
  });
});
