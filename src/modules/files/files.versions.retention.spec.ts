import { describe, expect, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import type { WorkspacesMongo } from "@/core/workspaces";
import { filesWorld } from "../../../test/files.harness";
import { versionsArea } from "../../../test/versions.harness";
import { retainVersions } from "./files.versions.retention";

const files = filesWorld();
const core = () => tenancy.core as unknown as WorkspacesMongo;

describe("version retention", () => {
  test("keeps the newest `max` versions and never the current one", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "v1");
    for (const n of [2, 3, 4]) await a.push(file.id, `v${n}`);
    const report = await retainVersions(a.mongo, core(), a.id, { max: 2 });
    expect(report.removed).toBe(2);
    expect((await a.versions(file.id)).map((v) => v.number)).toEqual([4, 3]);
    expect(await a.usage()).toMatchObject({ bytes: 4, versionBytes: 2 });
    const gone = await a.mongo.db.blobs.findFirst({ key: file.key });
    expect(gone?.refs).toBe(0);
  });

  test("drops versions older than the cutoff, except the current one", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "v1");
    await a.push(file.id, "v2");
    await a.mongo.db.versions.raw.updateMany(
      {},
      { $set: { createdAt: new Date(Date.now() - 200 * 86_400_000) } },
    );
    const report = await retainVersions(a.mongo, core(), a.id, { days: 90 });
    expect(report.removed).toBe(1);
    const list = await a.versions(file.id);
    expect(list.map((v) => [v.number, v.current])).toEqual([[2, true]]);
  });

  test("a file with a single, old version keeps it", async () => {
    const a = await versionsArea(files);
    const file = await a.add("a.txt", "v1");
    await a.mongo.db.versions.raw.updateMany(
      {},
      { $set: { createdAt: new Date(Date.now() - 400 * 86_400_000) } },
    );
    const report = await retainVersions(a.mongo, core(), a.id, {});
    expect(report.removed).toBe(0);
    expect(await a.versions(file.id)).toHaveLength(1);
  });
});
