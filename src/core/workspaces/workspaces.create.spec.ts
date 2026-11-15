import { describe, expect, test } from "bun:test";
import { world } from "../../../test/workspaces.harness";

const CREATE = `mutation($input: CreateWorkspaceInput!) {
  createWorkspace(input: $input) { id slug name myRole createdAt }
}`;

describe("createWorkspace", () => {
  test("makes the caller its OWNER, and it opens by id and by slug", async () => {
    const w = await world();
    const user = await w.h.account();
    const slug = w.slug();
    const created = await w.send(user, CREATE, {
      variables: { input: { name: "  Acme Files  ", slug } },
    });
    expect(created.errors).toBeUndefined();
    const workspace = created.data?.["createWorkspace"];
    expect(workspace).toMatchObject({
      slug,
      name: "Acme Files",
      myRole: "OWNER",
    });
    for (const ref of [workspace.id, slug]) {
      const read = await w.send(user, "{ workspace { id slug name myRole } }", {
        workspace: ref,
      });
      expect(read.data?.["workspace"]).toMatchObject({
        id: workspace.id,
        slug,
        myRole: "OWNER",
      });
    }
    const mine = await w.send(user, "{ myWorkspaces { id name } }");
    expect(mine.data?.["myWorkspaces"]).toEqual([
      { id: workspace.id, name: "Acme Files" },
    ]);
  });

  test("a slug already taken is 409 on the slug, whoever asks", async () => {
    const w = await world();
    const first = await w.workspaceOf();
    const other = await w.h.account();
    const result = await w.send(other, CREATE, {
      variables: { input: { name: "Again", slug: first.slug } },
    });
    expect(w.codeOf(result)).toBe("workspaces.errors.slug-taken");
    expect(result.response.status).toBe(409);
    expect(
      (result.errors?.[0]?.extensions as { field?: string } | undefined)?.field,
    ).toBe("slug");
    expect(
      (await w.send(other, "{ myWorkspaces { id } }")).data?.["myWorkspaces"],
    ).toEqual([]);
  });

  test("two creations of one slug at once leave one workspace", async () => {
    const w = await world();
    const one = await w.h.account();
    const two = await w.h.account();
    const slug = w.slug();
    const results = await Promise.all(
      [one, two].map((user) =>
        w.send(user, CREATE, { variables: { input: { name: "Race", slug } } }),
      ),
    );
    const failed = results.filter((r) => r.errors);
    expect(failed).toHaveLength(1);
    expect(w.codeOf(failed[0] as never)).toBe("workspaces.errors.slug-taken");
  });

  test("an invalid name or slug is 400 invalid-input", async () => {
    const w = await world();
    const user = await w.h.account();
    const inputs = [
      { name: "A", slug: "Upper" },
      { name: "A", slug: "-lead" },
      { name: "A", slug: "trail-" },
      { name: "A", slug: "has space" },
      { name: "A", slug: "x".repeat(41) },
      { name: "A", slug: "" },
      { name: "", slug: "fine" },
      { name: "   ", slug: "fine" },
      { name: "x".repeat(101), slug: "fine" },
      // An id's shape: the header would read it as an id, not a slug.
      { name: "A", slug: "64b7f0c2a1d3e4f5a6b7c8d9" },
    ];
    for (const input of inputs) {
      const result = await w.send(user, CREATE, { variables: { input } });
      expect(w.codeOf(result)).toBe("validation.errors.invalid-input");
      expect(result.response.status).toBe(400);
    }
    expect(
      (await w.send(user, "{ myWorkspaces { id } }")).data?.["myWorkspaces"],
    ).toEqual([]);
  });

  test("needs a session, and refuses a personal API key", async () => {
    const w = await world();
    const input = { name: "A", slug: w.slug() };
    const anonymous = await w.send(null, CREATE, { variables: { input } });
    expect(w.codeOf(anonymous)).toBe("auth.errors.unauthenticated");
    const user = await w.h.account();
    const key = await w.h.apiKey(user);
    const keyed = await w.h.client.query(CREATE, {
      variables: { input },
      headers: { authorization: `Bearer ${key}` },
    });
    expect(keyed.errors?.[0]?.extensions?.code).toBe(
      "auth.errors.api-key-not-accepted",
    );
  });

  test("is rate limited per address", async () => {
    const calls: (string | undefined)[] = [];
    const { harness } = await import("@/core/identity/identity.harness");
    const h = await harness({
      limits: {
        signUp: async () => undefined,
        signIn: async () => undefined,
        passwordReset: async () => undefined,
        workspaceCreate: async (ip) => {
          calls.push(ip);
        },
      },
    });
    const user = await h.account();
    await h.client.query(CREATE, {
      variables: {
        input: { name: "A", slug: `rl-${crypto.randomUUID().slice(0, 8)}` },
      },
      headers: user.headers,
    });
    expect(calls).toHaveLength(1);
  });
});
