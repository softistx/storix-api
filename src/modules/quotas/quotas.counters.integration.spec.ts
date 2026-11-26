import { describe, expect, test } from "bun:test";
import { connection } from "@/config/db";
import { env } from "@/config/env";
import { store } from "@/config/tenancy";
import { setQuota } from "@/core/workspaces";
import { workspacesQuota } from "@/core/workspaces/migrations/2026-11-20-workspaces-quota.migration";
import { ADD, COPY, filesWorld } from "../../../test/files.harness";
import { recountStorage } from "../files/public";
import { reconcileAll, reconcileUsage } from "./public";
import {
  area as areaOf,
  code,
  core,
  databaseOf,
  STORAGE,
} from "./quotas.harness";

const files = filesWorld();
const area = () => areaOf(files);

describe("the quota counters of a workspace", () => {
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
