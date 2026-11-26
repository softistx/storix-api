import { describe, expect, test } from "bun:test";
import { store, tenancy } from "@/config/tenancy";
import { filesWorld } from "../../test/files.harness";
import { workspacesMongo } from "../core/workspaces";
import { filesMongo } from "../modules/files/public";
import { setup } from "../modules/nodes/nodes.harness";
import { runStorageSweep } from "./storage-sweep.run";

// The script's summary and exit code when a brake trips or the cap is hit.
const files = filesWorld();

const run = (bucket = files.ctx.bucket) =>
  runStorageSweep(
    workspacesMongo(tenancy.core),
    (id) => store.databaseOf(id),
    bucket,
  );

const countOf = (summary: string, what: string) =>
  Number(new RegExp(`(\\d+) workspaces ${what}`).exec(summary)?.[1]);

describe("the storage sweep script and its brakes", () => {
  test("a braked workspace is printed and makes the script exit 2", async () => {
    const { workspace } = await setup(files.ctx.w);
    const mongo = filesMongo(await store.databaseOf(workspace.id));
    // The workspace's objects date from now: past the margin through a
    // bucket that ages them, with no blob recording any.
    for (let i = 0; i < 10; i++) {
      await files.upload(workspace.owner, workspace.id, `o${i}`);
    }
    await mongo.db.blobs.raw.deleteMany({});
    const aged = {
      delete: (...args: Parameters<typeof files.ctx.bucket.delete>) =>
        files.ctx.bucket.delete(...args),
      list: async (...args: Parameters<typeof files.ctx.bucket.list>) => {
        const page = await files.ctx.bucket.list(...args);
        const at = new Date(Date.now() - 3 * 60 * 60_000);
        return {
          ...page,
          items: page.items.map((item) => ({ ...item, lastModified: at })),
        };
      },
    };
    const out = await run(aged as typeof files.ctx.bucket);
    expect(countOf(out.summary, "braked")).toBeGreaterThanOrEqual(1);
    expect(out.exitCode).toBe(2);
  });

  test("with nothing to stop it, the summary says none braked or capped and it exits 0", async () => {
    await setup(files.ctx.w);
    const out = await run();
    expect(countOf(out.summary, "braked")).toBe(0);
    expect(countOf(out.summary, "capped")).toBe(0);
    expect(out.exitCode).toBe(0);
  });
});
