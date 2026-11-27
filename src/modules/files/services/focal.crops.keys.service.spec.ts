import { describe, expect, test } from "bun:test";
import { field } from "../../../../test/files.area";
import { picture } from "../../../../test/files.focal.harness";
import { COPY } from "../../../../test/files.harness";
import { ROOTS } from "../../../../test/nodes.harness";
import { ADD_VERSION } from "../../../../test/shares.harness";
import { cropsKeyOf } from "../rules";
import {
  databaseOf,
  drain,
  files,
  jobs,
  keysOf,
  move,
  run,
  twoOwners,
} from "./focal.crops.service.harness";

describe("the crops key follows the settled crops", () => {
  test("a copy made after a move serves the original's crops key", async () => {
    const { a, original } = await twoOwners();
    await drain(a.workspace.id);
    await move(a, a.users.owner, original.id, { x: 0.6, y: 0.4 });
    await drain(a.workspace.id);
    const mine = await keysOf(a, a.users.owner, original.id);
    const roots = await a.sendAs(a.users.editor, ROOTS);
    const [root] = field<{ id: string }[]>(roots, "roots");
    const copied = await a.sendAs(a.users.editor, COPY, {
      ids: [original.id],
      parentId: root?.id,
    });
    const [again] = field<{ id: string }[]>(copied, "copyNodes");
    const theirs = await keysOf(
      a,
      a.users.editor,
      (again as { id: string }).id,
    );
    expect(theirs.cropsKey).toBe(mine.cropsKey);
    const read = await files.call(
      a.users.editor,
      a.workspace.id,
      `/media/files/${theirs.cropsKey}/square`,
    );
    expect(read.status).toBe(200);
  });

  test("a new version serves its own key, which has no point until it is set", async () => {
    const { a, original } = await twoOwners();
    await drain(a.workspace.id);
    await move(a, a.users.owner, original.id, { x: 0.6, y: 0.4 });
    await drain(a.workspace.id);
    const up = await files.upload(
      a.users.owner,
      a.workspace.id,
      picture(1000, 1000),
      "image/png",
    );
    const pushed = await a.sendAs(a.users.owner, ADD_VERSION, {
      fileId: original.id,
      key: up.key,
    });
    expect(pushed.errors).toBeUndefined();
    const during = await keysOf(a, a.users.owner, original.id);
    expect(during.key).toBe(up.key);
    expect(during.cropsKey).toBe(up.key);
    await drain(a.workspace.id);
    const after = await keysOf(a, a.users.owner, original.id);
    // A new upload starts without a focal point: its crops are its own key.
    expect(after.cropsKey).toBe(up.key);
    expect(after.cropsKey).not.toBe(cropsKeyOf(up.key, { x: 0.6, y: 0.4 }));
  });

  test("a failed job gives up its own point's nodes only, and a later success heals them", async () => {
    const { a, original, copy } = await twoOwners();
    await drain(a.workspace.id);
    const p1 = { x: 0.95, y: 0.5 };
    const p2 = { x: 0.05, y: 0.5 };
    await move(a, a.users.owner, original.id, p1);
    await move(a, a.users.editor, copy.id, p2);
    const [first, second] = jobs.splice(0);
    const at = async (x: number) =>
      (await databaseOf(a.workspace.id)).db.nodes.raw.findOne({
        "focalPoint.x": x,
      });
    await Promise.resolve(run(first, { broken: true, attempt: 3 })).catch(
      () => {},
    );
    await run(second);
    expect(await at(p1.x)).toMatchObject({ cropsStatus: "FAILED" });
    expect(await at(p2.x)).toMatchObject({ cropsStatus: "READY" });
    await run(first);
    expect(await at(p1.x)).toMatchObject({ cropsStatus: "READY" });
  });
});
