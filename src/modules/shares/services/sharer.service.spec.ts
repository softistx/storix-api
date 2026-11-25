import { describe, expect, test } from "bun:test";
import { roleArea } from "../../../../test/roles.harness";
import { nodeToRead, nodeToShare } from "./sharer.service";

describe("nodeToShare and nodeToRead", () => {
  test("an editor shares, a viewer is told owner-only, a stranger sees nothing", async () => {
    const a = await roleArea();
    const editor = await a.w.join(a.workspace, "MEMBER");
    const viewer = await a.w.join(a.workspace, "MEMBER");
    const stranger = await a.w.join(a.workspace, "MEMBER");
    await a.grant(
      a.folder.id,
      { type: "MEMBER", id: editor.memberId },
      "EDITOR",
    );
    await a.grant(
      a.folder.id,
      { type: "MEMBER", id: viewer.memberId },
      "VIEWER",
    );
    const seat = (memberId: string) => ({ accountId: "x", memberId });
    const share = (memberId: string) =>
      nodeToShare(a.database, seat(memberId), a.child.id);
    expect((await share(editor.memberId)).name).toBe("Child");
    await expect(share(viewer.memberId)).rejects.toMatchObject({
      extensions: { code: "shares.errors.owner-only" },
    });
    await expect(share(stranger.memberId)).rejects.toMatchObject({
      extensions: { code: "shares.errors.not-found" },
    });
    expect(
      (await nodeToRead(a.database, seat(viewer.memberId), a.child.id)).name,
    ).toBe("Child");
    await expect(
      nodeToRead(a.database, seat(stranger.memberId), a.child.id),
    ).rejects.toBeDefined();
  });

  test("an unknown or malformed id is a missing node", async () => {
    const a = await roleArea();
    const node = await a.nodeOf(a.folder.id);
    const owner = node.ownerId as string;
    await expect(nodeToShare(a.database, owner, "nope")).rejects.toBeDefined();
    await expect(
      nodeToShare(a.database, owner, "0".repeat(24)),
    ).rejects.toBeDefined();
  });
});
