import { beforeAll, describe, expect, test } from "bun:test";
import { filesWorld } from "../../../../test/files.harness";
import { DELETE, versionsArea } from "../../../../test/versions.harness";

const files = filesWorld();

// One area for the file, made once after the world's hooks: provisioning a
// workspace database costs about a second, and each test adds its own file.
let a: Awaited<ReturnType<typeof versionsArea>>;
beforeAll(async () => {
  a = await versionsArea(files);
});

describe("reading a version's object", () => {
  test("an old version's key is readable by the owner and not by another account", async () => {
    const file = await a.add("a.txt", "one");
    await a.push(file.id, "twenty");
    const other = await a.w.h.account();
    const get = (user: typeof a.owner, key: string) =>
      files.call(user, a.id, `/media/files/${key}`);
    expect((await get(a.owner, file.key)).status).toBe(200);
    expect((await get(other, file.key)).status).toBe(404);
  });

  test("a deleted version's key is no longer readable", async () => {
    const file = await a.add("b.txt", "one");
    await a.push(file.id, "twenty");
    const v1 = (await a.versions(file.id)).find((v) => v.number === 1);
    await a.send(DELETE, { fileId: file.id, versionId: v1?.id });
    const res = await files.call(a.owner, a.id, `/media/files/${file.key}`);
    expect(res.status).toBe(404);
  });
});
