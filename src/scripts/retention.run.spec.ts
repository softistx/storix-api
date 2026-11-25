import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { store } from "@/config/tenancy";
import { failDeleteOn } from "../../test/fail-delete";
import { filesWorld } from "../../test/files.harness";
import { trashArea } from "../../test/trash.harness";
import { runRetention } from "./retention.run";

const files = filesWorld();
const DAY = 86_400_000;

let spies: { mockRestore: () => void }[] = [];
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  spies = [];
});

// The workspaces of the other specs are active too: only this one's database
// is read, the others answer from the store as they do in production.
const quiet = () =>
  spies.push(spyOn(console, "error").mockImplementation(() => {}));

describe("the retention script", () => {
  test("exits 0 when everything was settled", async () => {
    const a = await trashArea(files);
    const file = await files.addFile(
      a.owner,
      a.id,
      a.root.id,
      "a.txt",
      "alpha",
    );
    await a.trash([file]);
    await a.mongo.db.nodes.raw.updateOne(
      { name: "a.txt" },
      { $set: { trashedAt: new Date(Date.now() - 40 * DAY) } },
    );
    const { exitCode, summary } = await runRetention(a.core(), (id) =>
      store.databaseOf(id),
    );
    expect(exitCode).toBe(0);
    expect(summary).toMatch(
      /0 workspaces and 0 trash entries or files failed$/,
    );
    expect(await a.trashed()).toEqual([]);
  });

  test("exits 1 when a trash entry could not be purged", async () => {
    const a = await trashArea(files);
    const file = await files.addFile(
      a.owner,
      a.id,
      a.root.id,
      "a.txt",
      "alpha",
    );
    await a.trash([file]);
    await a.mongo.db.nodes.raw.updateOne(
      { name: "a.txt" },
      { $set: { trashedAt: new Date(Date.now() - 40 * DAY) } },
    );
    quiet();
    spies.push(failDeleteOn("nodes", 1, a.id));
    const { exitCode, summary } = await runRetention(a.core(), (id) =>
      store.databaseOf(id),
    );
    expect(exitCode).toBe(1);
    expect(summary).toMatch(/ 1 trash entries or files failed$/);
  });

  test("exits 1 when a workspace could not be opened", async () => {
    const a = await trashArea(files);
    quiet();
    const { exitCode, summary } = await runRetention(a.core(), (id) =>
      id === a.id ? Promise.reject(new Error("down")) : store.databaseOf(id),
    );
    expect(exitCode).toBe(1);
    expect(summary).toMatch(/ 2 workspaces and /);
  });
});
