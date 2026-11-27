import { describe, expect, test } from "bun:test";
import { filesWorld } from "../../../test/files.harness";
import { setup } from "../../../test/nodes.harness";

const files = filesWorld();

const FILE_OWNER = `query($id: ID!) { node(id: $id) { ... on File { id ownerId owner { accountId name } } } }`;

describe("File.owner", () => {
  test.each(["OWNER", "ADMIN", "MEMBER"] as const)(
    "a %s reads the owner of their own file",
    async (role) => {
      const s = await setup(files.ctx.w);
      const user =
        role === "OWNER"
          ? s.workspace.owner
          : (await s.w.join(s.workspace, role)).user;
      const as = s.as(user);
      const root = await as.root();
      const file = await files.addFile(user, s.workspace.id, root.id, "a.txt");
      const result = await as.send(FILE_OWNER, { id: file.id });
      expect(result.errors).toBeUndefined();
      const node = result.data?.["node"] as {
        ownerId: string;
        owner: { accountId: string; name: string } | null;
      };
      expect(node.ownerId).toBe(user.principal.accountId);
      expect(node.owner).toEqual({
        accountId: user.principal.accountId,
        name: user.principal.name,
      });
    },
  );
});
