import { describe, expect, test } from "bun:test";
import { filesWorld } from "../../../test/files.harness";
import { SHARE } from "../../../test/shares.harness";
import { area as areaOf } from "./quotas.harness";

const files = filesWorld();
const area = () => areaOf(files);

type Listed = { id: string; name: string; size: number }[];
const largest = (r: { data?: Record<string, unknown> | null }): Listed =>
  (r.data?.["storage"] as { largestFiles: Listed } | undefined)?.largestFiles ??
  [];

const LARGEST = `query($first: Int) { storage { largestFiles(first: $first) { id name size } } }`;

describe("Storage.largestFiles", () => {
  test("lists the live files biggest first and leaves trashed files out", async () => {
    const a = await area();
    const { owner, id } = a.workspace;
    const small = await files.addFile(owner, id, a.root.id, "s.txt", "a");
    const big = await files.addFile(
      owner,
      id,
      a.root.id,
      "b.txt",
      "a".repeat(30),
    );
    const mid = await files.addFile(
      owner,
      id,
      a.root.id,
      "m.txt",
      "a".repeat(10),
    );
    const gone = await files.addFile(
      owner,
      id,
      a.root.id,
      "g.txt",
      "a".repeat(90),
    );
    await a.send(`mutation($ids: [ID!]!) { trashNodes(ids: $ids) { id } }`, {
      ids: [gone.id],
    });
    const result = await a.send(LARGEST);
    expect(result.errors).toBeUndefined();
    const listed = largest(result).map((f) => f.id);
    expect(listed).toEqual([big.id, mid.id, small.id]);
  });

  test("first limits the answer and is capped at 50", async () => {
    const a = await area();
    const { owner, id } = a.workspace;
    for (const n of [1, 2, 3]) {
      await files.addFile(owner, id, a.root.id, `f${n}.txt`, "a".repeat(n));
    }
    const two = await a.send(LARGEST, { first: 2 });
    const rows = largest(two);
    expect(rows).toHaveLength(2);
    const huge = await a.send(LARGEST, { first: 50 });
    expect(huge.errors).toBeUndefined();
    const all = largest(huge);
    expect(all.length).toBeLessThanOrEqual(50);
  });

  test("a file in another member's private tree is not named", async () => {
    const a = await area();
    const member = await a.w.join(a.workspace, "MEMBER");
    const theirs = a.as(member.user);
    const mine = await files.addFile(
      a.workspace.owner,
      a.workspace.id,
      a.root.id,
      "mine.txt",
      "a".repeat(5),
    );
    const root = await theirs.root();
    await files.addFile(
      member.user,
      a.workspace.id,
      root.id,
      "private.txt",
      "a".repeat(500),
    );
    const result = await a.w.send(a.workspace.owner, LARGEST, {
      ...a.at,
    });
    const names = largest(result).map((f) => f.name);
    expect(names).toEqual(["mine.txt"]);
    expect(mine.id).toBeTruthy();
  });

  test("a private file shared with the caller is named", async () => {
    const a = await area();
    const sharer = await a.w.join(a.workspace, "MEMBER");
    const reader = await a.w.join(a.workspace, "MEMBER");
    const root = await a.as(sharer.user).root();
    const hidden = await files.addFile(
      sharer.user,
      a.workspace.id,
      root.id,
      "hidden.txt",
      "a".repeat(40),
    );
    const before = await a.w.send(reader.user, LARGEST, { ...a.at });
    expect(largest(before)).toEqual([]);
    const shared = await a.w.send(sharer.user, SHARE, {
      ...a.at,
      variables: {
        id: hidden.id,
        principal: { type: "MEMBER", id: reader.memberId },
        role: "VIEWER",
      },
    });
    expect(shared.errors).toBeUndefined();
    const after = await a.w.send(reader.user, LARGEST, { ...a.at });
    expect(largest(after).map((f) => f.id)).toEqual([hidden.id]);
  });

  test("keeps reading past a batch of files the caller cannot read", async () => {
    const a = await area();
    const member = await a.w.join(a.workspace, "MEMBER");
    const root = await a.as(member.user).root();
    for (let n = 0; n < 101; n++) {
      await files.addFile(
        member.user,
        a.workspace.id,
        root.id,
        `p${n}.txt`,
        "a".repeat(20),
      );
    }
    const mine = await files.addFile(
      a.workspace.owner,
      a.workspace.id,
      a.root.id,
      "mine.txt",
      "a",
    );
    const result = await a.w.send(a.workspace.owner, LARGEST, { ...a.at });
    expect(largest(result).map((f) => f.id)).toEqual([mine.id]);
  }, 120_000);
});
