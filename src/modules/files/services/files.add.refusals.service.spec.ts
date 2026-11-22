import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import {
  ADD,
  type FileView,
  fileOf,
  filesWorld,
} from "../../../../test/files.harness";
import { setup } from "../../nodes/nodes.harness";
import { filesMongo } from "../models";

const files = filesWorld();

const databaseOf = async (id: string) => filesMongo(await store.databaseOf(id));

// The world of the nodes specs, over the files' storage.
async function area() {
  const s = await setup(files.ctx.w);
  return s;
}

describe("addFile refusals and races", () => {
  test("a key of another workspace, of another kind, malformed, never uploaded or already recorded is key-unknown", async () => {
    const { w, workspace, at, owner } = await area();
    const other = await w.workspaceOf();
    const root = await owner.root();
    const add = (key: string, name: string = crypto.randomUUID()) =>
      w.send(workspace.owner, ADD, {
        ...at,
        variables: { input: { key, name, parentId: root.id } },
      });
    const code = (r: Awaited<ReturnType<typeof add>>) =>
      r.errors?.[0]?.extensions?.code;
    const foreign = await files.upload(other.owner, other.id, "foreign");
    expect(code(await add(foreign.key))).toBe("files.errors.key-unknown");
    const avatar = await files
      .upload(workspace.owner, workspace.id, "png", "image/png", "avatars")
      .catch(() => null);
    // An avatar's key is not a `files` object (it may even be refused as not a PNG).
    if (avatar)
      expect(code(await add(avatar.key))).toBe("files.errors.key-unknown");
    expect(code(await add("not-a-key"))).toBe("files.errors.key-unknown");
    expect(code(await add(crypto.randomUUID()))).toBe(
      "files.errors.key-unknown",
    );
    const mine = await files.upload(workspace.owner, workspace.id, "mine");
    expect(code(await add(mine.key, "one"))).toBeUndefined();
    expect(code(await add(mine.key, "two"))).toBe("files.errors.key-unknown");
    const refusal = (await add(mine.key, "three")).errors?.[0]?.extensions as {
      code?: string;
      field?: string;
    };
    expect(refusal).toMatchObject({
      code: "files.errors.key-unknown",
      field: "key",
    });
  });

  test("two recorders of one key leave one file and one key-unknown", async () => {
    const { w, workspace, at, owner } = await area();
    const root = await owner.root();
    const up = await files.upload(workspace.owner, workspace.id, "race");
    const results = await Promise.all(
      ["a", "b", "c"].map((name) =>
        w.send(workspace.owner, ADD, {
          ...at,
          variables: { input: { key: up.key, name, parentId: root.id } },
        }),
      ),
    );
    const ok = results.filter((r) => !r.errors);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((r) => r.errors)) {
      expect(r.errors?.[0]?.extensions?.code).toBe("files.errors.key-unknown");
    }
    const db = await databaseOf(workspace.id);
    expect(await db.db.blobs.count({ key: up.key })).toBe(1);
  });

  test("two KEEP_BOTH adds of one name at once both land, under different names", async () => {
    const { w, workspace, at, owner } = await area();
    const root = await owner.root();
    const ups = await Promise.all(
      [1, 2, 3].map((n) =>
        files.upload(workspace.owner, workspace.id, `n${n}`),
      ),
    );
    const results = await Promise.all(
      ups.map((up) =>
        w.send(workspace.owner, ADD, {
          ...at,
          variables: {
            input: {
              key: up.key,
              name: "same.txt",
              parentId: root.id,
              onConflict: "KEEP_BOTH",
            },
          },
        }),
      ),
    );
    expect(results.every((r) => !r.errors)).toBe(true);
    const names = results.map((r) => fileOf(r).name);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(3);
  });

  test("a folder that is not the caller's, not a folder or too deep is refused", async () => {
    const { w, workspace, at, owner, as } = await area();
    const member = await w.join(workspace, "MEMBER");
    const mine = await owner.root();
    const theirs = await as(member.user).root();
    const up = await files.upload(workspace.owner, workspace.id, "x");
    const send = (parentId: string, key = up.key) =>
      w.send(workspace.owner, ADD, {
        ...at,
        variables: { input: { key, name: "f", parentId } },
      });
    expect((await send(theirs.id)).errors?.[0]?.extensions?.code).toBe(
      "nodes.errors.not-found",
    );
    // The refused try left the key free: it records afterwards.
    const first = await send(mine.id);
    expect(first.errors).toBeUndefined();
    const file = first.data?.["addFile"] as FileView;
    const up2 = await files.upload(workspace.owner, workspace.id, "y");
    expect((await send(file.id, up2.key)).errors?.[0]?.extensions?.code).toBe(
      "nodes.errors.not-a-folder",
    );
    let deep = mine;
    for (let i = 0; i < 15; i++) deep = await owner.folder(deep.id, `d${i}`);
    expect((await send(deep.id, up2.key)).errors?.[0]?.extensions?.code).toBe(
      "nodes.errors.too-deep",
    );
  });

  test("a name with a slash is refused as invalid input, and nothing is recorded", async () => {
    const { w, workspace, at, owner } = await area();
    const root = await owner.root();
    const up = await files.upload(workspace.owner, workspace.id, "x");
    const result = await w.send(workspace.owner, ADD, {
      ...at,
      variables: { input: { key: up.key, name: "a/b", parentId: root.id } },
    });
    expect(result.errors?.[0]?.extensions?.code).toBe(
      "validation.errors.invalid-input",
    );
    const db = await databaseOf(workspace.id);
    expect(await db.db.blobs.count({ key: up.key })).toBe(0);
  });

  test("needs a session and a workspace", async () => {
    const { w, workspace, at, owner } = await area();
    const root = await owner.root();
    const up = await files.upload(workspace.owner, workspace.id, "x");
    const variables = {
      input: { key: up.key, name: "a", parentId: root.id },
    };
    expect(
      (await w.send(null, ADD, { ...at, variables })).errors?.[0]?.extensions
        ?.code,
    ).toBe("auth.errors.unauthenticated");
    expect(
      (await w.send(workspace.owner, ADD, { variables })).errors?.[0]
        ?.extensions?.code,
    ).toBe("workspaces.errors.workspace-required");
  });

  test("records an audit event without the key", async () => {
    const { w, workspace, at, owner } = await area();
    const root = await owner.root();
    const up = await files.upload(workspace.owner, workspace.id, "audit");
    await w.send(workspace.owner, ADD, {
      ...at,
      variables: { input: { key: up.key, name: "a.txt", parentId: root.id } },
    });
    const log = await w.send(
      workspace.owner,
      `{ auditEvents(filter: { action: "file.add" }) { nodes { action target { type name } meta } } }`,
      at,
    );
    const events = log.data?.["auditEvents"].nodes as {
      target: { type: string; name: string };
      meta: Record<string, unknown>;
    }[];
    expect(events).toHaveLength(1);
    expect(events[0]?.target).toEqual({ type: "FILE", name: "a.txt" });
    expect(events[0]?.meta).toMatchObject({
      mimeType: "text/plain",
      size: 5,
      parentId: root.id,
    });
    expect(JSON.stringify(events)).not.toContain(up.key);
  });
});
