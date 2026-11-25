import { describe, expect, test } from "bun:test";
import { COPY, filesWorld } from "../../../../test/files.harness";
import { sharesArea } from "../../../../test/shares.harness";

const files = filesWorld();

describe("mayRead, on a blob two nodes hold", () => {
  test("a copy that stays private does not hide the share, and a non-grantee still gets a 404", async () => {
    const a = await sharesArea(files);
    const root = await a.owner.root();
    const copy = await a.sendAs(a.users.owner, COPY, {
      ids: [a.file.id],
      parentId: root.id,
    });
    expect(copy.errors).toBeUndefined();
    expect(copy.data?.["copyNodes"]).toHaveLength(1);
    expect(copy.data?.["copyNodes"][0].id).not.toBe(a.file.id);

    expect((await a.media(a.users.owner, a.file.key)).status).toBe(200);
    expect((await a.media(a.users.viewer, a.file.key)).status).toBe(200);
    expect((await a.media(a.users.team, a.file.key)).status).toBe(200);
    expect((await a.media(a.users.stranger, a.file.key)).status).toBe(404);
  });

  test("a grantee reaches the blob past fifty private copies of it", async () => {
    const a = await sharesArea(files);
    const root = await a.owner.root();
    for (let i = 0; i < 51; i++) {
      const copy = await a.sendAs(a.users.owner, COPY, {
        ids: [a.file.id],
        parentId: root.id,
      });
      expect(copy.errors).toBeUndefined();
    }
    const late = await a.owner.folder(root.id, "Late");
    const last = await a.sendAs(a.users.owner, COPY, {
      ids: [a.file.id],
      parentId: late.id,
    });
    expect(last.errors).toBeUndefined();
    const reader = await a.w.join(a.workspace, "MEMBER");
    await a.share(late.id, "MEMBER", reader.memberId, "VIEWER");

    expect((await a.media(reader.user, a.file.key)).status).toBe(200);
    expect((await a.media(a.users.stranger, a.file.key)).status).toBe(404);
  }, 120_000);
});
