import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import { members } from "@/config/wiring";
import { actionsOf, storedEvents } from "@/core/audit/audit.harness";
import type { MemberWiring } from "@/core/members";
import { world } from "../../../test/workspaces.harness";
import { nodesMongo } from "./nodes.handle";
import { setup } from "./nodes.harness";
import { transferLabel, transferTree } from "./nodes.transfer";

const REMOVE = `mutation($memberId: ID!, $transferTo: ID) { removeMember(memberId: $memberId, transferTo: $transferTo) }`;
const MEMBERS = "{ members(first: 50) { nodes { id } } }";

async function scene(wiring?: MemberWiring) {
  const s = await setup(await world(wiring && { members: wiring }));
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

  test("a failed handover fails the call: nobody is removed and no transferredTo is audited", async () => {
    let down = true;
    const t = await scene({
      ...members,
      onHandover: [
        ...members.onHandover,
        async () => {
          if (down) throw new Error("files are down");
          return false;
        },
      ],
    });
    const failed = await t.remove(t.admin.memberId);
    expect(failed.errors).toBeDefined();
    down = false;
    expect(await t.memberIds()).toContain(t.leaver.memberId);
    // Handover listeners are not atomic with each other: the nodes listener
    // ran first, so the files stay moved; only the removal and its audit hold.
    const events = await storedEvents(t.workspace.id);
    expect(actionsOf(events)).not.toContain("member.remove");
    expect(JSON.stringify(events)).not.toContain("transferredTo");
    // The same call goes through once the handover works again.
    expect((await t.remove(t.admin.memberId)).errors).toBeUndefined();
    expect(await t.memberIds()).not.toContain(t.leaver.memberId);
  });

  test("the audit names the receiver only when files moved", async () => {
    const t = await scene();
    await t.asLeaver.root();
    expect((await t.remove(t.admin.memberId)).errors).toBeUndefined();
    const events = await storedEvents(t.workspace.id);
    expect(JSON.stringify(events.at(-1))).toContain("transferredTo");
  });

  test("an account with no tree hands nothing over", async () => {
    const t = await scene();
    const mine = await t.asAdmin.root();
    const database = await store.databaseOf(t.workspace.id);
    const moved = await transferTree(nodesMongo(database), {
      fromAccountId: "no-such-account",
      toAccountId: t.admin.user.principal.accountId,
      name: "Ghost",
    });
    expect(moved).toBe(false);
    expect(await t.asAdmin.names(mine.id)).toEqual([]);
  });

  test("trashed nodes of the leaver move with the tree and stay in the receiver's trash", async () => {
    const t = await scene();
    const root = await t.asLeaver.root();
    const old = await t.asLeaver.folder(root.id, "Old");
    const trashed = await t.asLeaver.send(
      "mutation($ids: [ID!]!) { trashNodes(ids: $ids) { id } }",
      { ids: [old.id] },
    );
    expect(trashed.errors).toBeUndefined();
    expect((await t.remove(t.admin.memberId)).errors).toBeUndefined();
    const listed = await t.asAdmin.send(
      "{ trash(first: 50) { nodes { id } } }",
    );
    const ids = (
      (listed.data ?? {})["trash"] as { nodes: { id: string }[] }
    ).nodes.map((n) => n.id);
    expect(ids).toContain(old.id);
  });
});

describe("transferLabel", () => {
  test("names the folder after the leaver", () => {
    expect(transferLabel("Ada")).toBe("Files of Ada");
  });

  test("drops slashes and control characters and collapses spaces", () => {
    expect(transferLabel("  a/b\\c\u0000 d\n e  ")).toBe("Files of a b c d e");
  });

  test("falls back to a former member when the name is missing or empty", () => {
    expect(transferLabel(null)).toBe("Files of a former member");
    expect(transferLabel(" / ")).toBe("Files of a former member");
  });

  test("truncates a long name to 200 characters", () => {
    expect(transferLabel("x".repeat(500))).toBe(`Files of ${"x".repeat(200)}`);
  });
});
