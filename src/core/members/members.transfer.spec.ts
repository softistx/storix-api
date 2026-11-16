import { describe, expect, test } from "bun:test";
import { setup } from "../../modules/nodes/nodes.harness";

const REMOVE = `mutation($memberId: ID!, $transferTo: ID) { removeMember(memberId: $memberId, transferTo: $transferTo) }`;
const MEMBERS = "{ members(first: 50) { nodes { id } } }";

async function scene() {
  const s = await setup();
  const { w, workspace } = s;
  const admin = await w.join(workspace, "ADMIN");
  const leaver = await w.join(workspace, "MEMBER");
  const asAdmin = s.as(admin.user);
  const asLeaver = s.as(leaver.user);
  const remove = (transferTo?: string | null, memberId = leaver.memberId) =>
    s.owner.send(REMOVE, { memberId, transferTo: transferTo ?? null });
  const memberIds = async () => {
    const page = await s.owner.send(MEMBERS);
    const members = page.data?.["members"] as { nodes: { id: string }[] };
    return members.nodes.map((n) => n.id);
  };
  return { ...s, admin, leaver, asAdmin, asLeaver, remove, memberIds };
}

describe("removeMember with transferTo", () => {
  test("the leaver's tree moves under the receiver's root, owned by the receiver", async () => {
    const t = await scene();
    const root = await t.asLeaver.root();
    const reports = await t.asLeaver.folder(root.id, "Reports");
    const deep = await t.asLeaver.folder(reports.id, "2026");
    const mine = await t.asAdmin.root();

    const removed = await t.remove(t.admin.memberId);
    expect(removed.errors).toBeUndefined();
    expect(removed.data?.["removeMember"]).toBe(true);
    expect(await t.memberIds()).not.toContain(t.leaver.memberId);

    // The receiver now reads the leaver's old root as a folder of their own.
    expect(await t.asAdmin.names(mine.id)).toEqual(["Files of Ada"]);
    const [held] = (await t.asAdmin
      .send(
        `query($parentId: ID) { folders(parentId: $parentId) { id name ancestors } }`,
        { parentId: mine.id },
      )
      .then((r) => r.data?.["folders"])) as {
      id: string;
      ancestors: string[];
    }[];
    expect(held?.id).toBe(root.id);
    expect(held?.ancestors).toEqual([mine.id]);
    expect(await t.asAdmin.names(root.id)).toEqual(["Reports"]);
    const path = await t.asAdmin.send(
      `query($id: ID!) { nodePath(id: $id) { name depth } }`,
      { id: deep.id },
    );
    expect(
      path.data?.["nodePath"].map((n: { name: string }) => n.name),
    ).toEqual(["My files", "Files of Ada", "Reports", "2026"]);
  });

  test("a second leaver with the same name gets a numbered folder", async () => {
    const t = await scene();
    const other = await t.w.join(t.workspace, "MEMBER");
    const mine = await t.asAdmin.root();
    expect((await t.remove(t.admin.memberId)).errors).toBeUndefined();
    const second = await t.remove(t.admin.memberId, other.memberId);
    expect(second.errors).toBeUndefined();
    expect(await t.asAdmin.names(mine.id)).toEqual([
      "Files of Ada",
      "Files of Ada (1)",
    ]);
  });

  test("a receiver who is the leaver, unknown, or gone is refused and nothing changes", async () => {
    const t = await scene();
    const gone = await t.w.join(t.workspace, "MEMBER");
    expect((await t.remove(null, gone.memberId)).errors).toBeUndefined();
    for (const target of [t.leaver.memberId, gone.memberId, "not-an-id"]) {
      const refused = await t.remove(target);
      expect(t.w.codeOf(refused)).toBe("validation.errors.invalid-input");
      expect(refused.response.status).toBe(400);
    }
    expect(await t.memberIds()).toContain(t.leaver.memberId);
    expect((await t.asLeaver.root()).id).toBeDefined();
  });

  test("without transferTo the files stay with the leaver, and a rejoin gets a new root", async () => {
    const t = await scene();
    const root = await t.asLeaver.root();
    expect((await t.remove()).errors).toBeUndefined();
    expect(await t.asAdmin.names((await t.asAdmin.root()).id)).toEqual([]);
    expect(root.id).toBeDefined();
  });

  test("a member without members:manage cannot remove, with or without a receiver", async () => {
    const t = await scene();
    const other = await t.w.join(t.workspace, "MEMBER");
    const refused = await t.w.send(other.user, REMOVE, {
      workspace: t.workspace.id,
      variables: { memberId: t.leaver.memberId, transferTo: other.memberId },
    });
    expect(t.w.codeOf(refused)).toBe("auth.errors.forbidden");
    expect(await t.memberIds()).toContain(t.leaver.memberId);
  });
});
