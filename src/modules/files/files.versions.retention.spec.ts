import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import type { WorkspacesMongo } from "@/core/workspaces";
import { failDeleteOn } from "../../../test/fail-delete";
import { filesWorld } from "../../../test/files.harness";
import { versionsArea } from "../../../test/versions.harness";
import { retainVersions } from "./files.versions.retention";

const files = filesWorld();
let spies: { mockRestore: () => void }[] = [];
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  spies = [];
});
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

  test("a file that fails is counted and logged, and the next files are still settled", async () => {
    const a = await versionsArea(files);
    const first = await a.add("a.txt", "v1");
    const second = await a.add("b.txt", "w1");
    for (const file of [first, second]) await a.push(file.id, `${file.name}2`);
    const logged = spyOn(console, "error").mockImplementation(() => {});
    spies.push(logged, failDeleteOn("versions", 1));
    const report = await retainVersions(a.mongo, core(), a.id, { max: 1 });
    expect(report).toEqual({ files: 1, removed: 1, failed: 1 });
    const counts = [
      (await a.versions(first.id)).length,
      (await a.versions(second.id)).length,
    ].sort();
    // One file lost its old version, the failed one kept both; a run again
    // settles it.
    expect(counts).toEqual([1, 2]);
    const line = logged.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.startsWith("version retention: file "));
    expect(line).toContain(`of workspace ${a.id} not settled:`);
    for (const spy of spies) spy.mockRestore();
    spies = [];
    expect(await retainVersions(a.mongo, core(), a.id, { max: 1 })).toEqual({
      files: 1,
      removed: 1,
      failed: 0,
    });
  });
});
