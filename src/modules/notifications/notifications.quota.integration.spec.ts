import { describe, expect, test } from "bun:test";
import { tenancy } from "@/config/tenancy";
import { setQuota, workspacesMongo } from "@/core/workspaces";
import { filesWorld } from "../../../test/files.harness";
import { ADD_VERSION } from "../../../test/shares.harness";
import { setup } from "../nodes/nodes.harness";

const files = filesWorld();
const INBOX = `{ notifications(first: 50) { nodes { kind percent } } }`;

async function area() {
  const s = await setup(files.ctx.w);
  const root = await s.owner.root();
  const admin = await s.w.join(s.workspace, "ADMIN");
  const member = await s.w.join(s.workspace, "MEMBER");
  return { ...s, root, admin, member };
}

const percents = async (
  a: Awaited<ReturnType<typeof area>>,
  user: typeof a.workspace.owner,
) => {
  const result = await a.w.send(user, INBOX);
  return (
    (result.data?.["notifications"]?.nodes ?? []) as {
      kind: string;
      percent: number;
    }[]
  )
    .filter((n) => n.kind === "QUOTA_THRESHOLD")
    .map((n) => n.percent)
    .sort((x, y) => x - y);
};

describe("the quota alerts on upload", () => {
  test("80 % and 100 % each tell the owner and the admins once, and a member never", async () => {
    const a = await area();
    const quota = 100;
    expect(
      await setQuota(workspacesMongo(tenancy.core), a.workspace.slug, quota),
    ).toBe(true);
    const up = (name: string, size: number) =>
      files.addFile(
        a.workspace.owner,
        a.workspace.id,
        a.root.id,
        name,
        "x".repeat(size),
      );

    await up("small.txt", 50);
    expect(await percents(a, a.workspace.owner)).toEqual([]);

    await up("big.txt", 35);
    expect(await percents(a, a.workspace.owner)).toEqual([80]);
    expect(await percents(a, a.admin.user)).toEqual([80]);
    await up("same.txt", 1);
    expect(await percents(a, a.workspace.owner)).toEqual([80]);

    await up("full.txt", 14);
    expect(await percents(a, a.workspace.owner)).toEqual([80, 100]);
    expect(await percents(a, a.admin.user)).toEqual([80, 100]);
    expect(await percents(a, a.member.user)).toEqual([]);

    const mails = a.w.h
      .mailsTo(a.admin.user.email)
      .filter((m) => m.subject.startsWith("notifications.mail.quota"));
    expect(mails).toHaveLength(2);
  });

  test("a new version that crosses the threshold tells too", async () => {
    const a = await area();
    await setQuota(workspacesMongo(tenancy.core), a.workspace.slug, 100);
    const file = await files.addFile(
      a.workspace.owner,
      a.workspace.id,
      a.root.id,
      "doc.txt",
      "x".repeat(10),
    );
    expect(await percents(a, a.workspace.owner)).toEqual([]);
    const up = await files.upload(
      a.workspace.owner,
      a.workspace.id,
      "y".repeat(75),
    );
    const added = await a.w.send(a.workspace.owner, ADD_VERSION, {
      workspace: a.workspace.id,
      variables: { fileId: file.id, key: up.key },
    });
    expect(added.errors).toBeUndefined();
    expect(await percents(a, a.workspace.owner)).toEqual([80]);
  });
});
