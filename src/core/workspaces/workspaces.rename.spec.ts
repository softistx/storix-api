import { describe, expect, test } from "bun:test";
import { world } from "../../../test/workspaces.harness";

const RENAME = `mutation($name: String!) { renameWorkspace(name: $name) { id slug name myRole } }`;
const READ = "{ workspace { name slug } }";

describe("renameWorkspace", () => {
  test("an owner renames: the name changes, the slug and id do not, and it is audited", async () => {
    const w = await world();
    const { id, slug, owner } = await w.workspaceOf();
    const at = { workspace: id };
    const renamed = await w.send(owner, RENAME, {
      ...at,
      variables: { name: "  New name  " },
    });
    expect(renamed.errors).toBeUndefined();
    expect(renamed.data?.["renameWorkspace"]).toEqual({
      id,
      slug,
      name: "New name",
      myRole: "OWNER",
    });
    const read = await w.send(owner, READ, at);
    expect(read.data?.["workspace"]).toEqual({ name: "New name", slug });
    const mine = await w.send(owner, "{ myWorkspaces { name } }");
    expect(mine.data?.["myWorkspaces"]).toEqual([{ name: "New name" }]);
    const events = await w.send(
      owner,
      `{ auditEvents(first: 10) { nodes { action target { type name } } } }`,
      at,
    );
    expect(events.data?.["auditEvents"].nodes).toContainEqual({
      action: "workspace.rename",
      target: { type: "WORKSPACE", name: "New name" },
    });
  });

  test("an admin renames; a member does not", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const at = { workspace: workspace.id };
    const admin = await w.join(workspace, "ADMIN");
    const member = await w.join(workspace, "MEMBER");
    const done = await w.send(admin.user, RENAME, {
      ...at,
      variables: { name: "By admin" },
    });
    expect(done.errors).toBeUndefined();
    expect(done.data?.["renameWorkspace"].myRole).toBe("ADMIN");
    const refused = await w.send(member.user, RENAME, {
      ...at,
      variables: { name: "By member" },
    });
    expect(w.codeOf(refused)).toBe("auth.errors.forbidden");
    expect(refused.response.status).toBe(403);
    const read = await w.send(workspace.owner, READ, at);
    expect(read.data?.["workspace"].name).toBe("By admin");
  });

  test("a blank or over-long name is refused as input, anonymous is 401, no header is 400", async () => {
    const w = await world();
    const { id, owner } = await w.workspaceOf();
    for (const name of ["   ", "x".repeat(101)]) {
      const refused = await w.send(owner, RENAME, {
        workspace: id,
        variables: { name },
      });
      expect(w.codeOf(refused)).toBe("validation.errors.invalid-input");
    }
    const anonymous = await w.send(null, RENAME, {
      workspace: id,
      variables: { name: "A" },
    });
    expect(w.codeOf(anonymous)).toBe("auth.errors.unauthenticated");
    const bare = await w.send(owner, RENAME, { variables: { name: "A" } });
    expect(w.codeOf(bare)).toBe("workspaces.errors.workspace-required");
  });
});
