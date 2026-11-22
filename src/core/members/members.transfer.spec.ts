import { describe, expect, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import { world } from "../../../test/workspaces.harness";
import { membersMongo } from "./models";
import { endMembership } from "./services";

const mongo = () => membersMongo(tenancy.core);

async function scene() {
  const w = await world();
  const workspace = await w.workspaceOf();
  const leaver = await w.join(workspace, "MEMBER");
  const receiver = await w.join(workspace, "MEMBER");
  const base = {
    workspaceId: workspace.id,
    actorId: workspace.owner.principal.accountId,
    canManageOwners: true,
  };
  return { w, workspace, leaver, receiver, base };
}

async function memberIds(s: Awaited<ReturnType<typeof scene>>) {
  const page = await s.w.send(
    s.workspace.owner,
    "{ members(first: 50) { nodes { id } } }",
    { workspace: s.workspace.id },
  );
  const nodes = (page.data?.["members"] ?? { nodes: [] }) as {
    nodes: { id: string }[];
  };
  return nodes.nodes.map((n) => n.id);
}

const isMember = async (s: Awaited<ReturnType<typeof scene>>, id: string) =>
  (await memberIds(s)).includes(id);

describe("endMembership with a receiver", () => {
  test("hands the receiver read inside the transaction to beforeCommit", async () => {
    const s = await scene();
    const seen: string[] = [];
    await endMembership(mongo(), {
      ...s.base,
      memberId: s.leaver.memberId,
      transferTo: s.receiver.memberId,
      beforeCommit: async (target, receiver) => {
        seen.push(target.id, receiver?.id ?? "none");
      },
    });
    expect(seen).toEqual([s.leaver.memberId, s.receiver.memberId]);
    expect(await isMember(s, s.leaver.memberId)).toBe(false);
  });

  test("a receiver who already left, is unknown or is the leaver refuses and removes nobody", async () => {
    const s = await scene();
    await endMembership(mongo(), {
      ...s.base,
      memberId: s.receiver.memberId,
    });
    for (const transferTo of [
      s.receiver.memberId,
      s.leaver.memberId,
      "not-an-id",
      "64b000000000000000000000",
    ]) {
      const attempt = endMembership(mongo(), {
        ...s.base,
        memberId: s.leaver.memberId,
        transferTo,
        beforeCommit: async () => {
          throw new Error("must not hand over");
        },
      });
      await expect(attempt).rejects.toMatchObject({
        extensions: { code: "validation.errors.invalid-input" },
      });
    }
    expect(await isMember(s, s.leaver.memberId)).toBe(true);
  });

  test("a receiver removed concurrently never receives the handover once gone", async () => {
    const s = await scene();
    let sawGone = false;
    const handover = endMembership(mongo(), {
      ...s.base,
      memberId: s.leaver.memberId,
      transferTo: s.receiver.memberId,
      beforeCommit: async (_, receiver) => {
        const ids = await memberIds(s);
        // The write lock on the receiver serialises the two removals, so a
        // handover never runs with a receiver already committed as gone.
        if (receiver && !ids.includes(receiver.id)) sawGone = true;
      },
    });
    const removal = endMembership(mongo(), {
      ...s.base,
      memberId: s.receiver.memberId,
    });
    const [done, removed] = await Promise.allSettled([handover, removal]);
    expect(sawGone).toBe(false);
    expect(removed.status).toBe("fulfilled");
    if (done.status === "rejected") {
      expect(done.reason).toMatchObject({
        extensions: { code: "validation.errors.invalid-input" },
      });
      expect(await isMember(s, s.leaver.memberId)).toBe(true);
    } else {
      expect(await isMember(s, s.leaver.memberId)).toBe(false);
    }
  });
});
