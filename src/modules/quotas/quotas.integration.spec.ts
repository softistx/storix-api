import { describe, expect, test } from "bun:test";
import { setQuota } from "@/core/workspaces";
import { ADD, filesWorld } from "../../../test/files.harness";
import {
  area as areaOf,
  code,
  core,
  databaseOf,
  objects,
} from "./quotas.harness";

const files = filesWorld();
const area = () => areaOf(files);
const bucketObjects = () => objects(files);

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
    const before = await bucketObjects();
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
    expect(await bucketObjects()).toBe(before);
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
    const before = await bucketObjects();
    const refused = await send(ADD, {
      input: { key: second.key, name: "b.txt", parentId: root.id },
    });
    expect(code(refused)).toBe("quotas.errors.exceeded");
    expect(refused.response.status).toBe(413);
    expect(await bucketObjects()).toBe(before - 1);
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
});
