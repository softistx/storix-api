import { describe, expect, test } from "bun:test";
import { filesWorld } from "../../../test/files.harness";
import { CREATE, MOVE, RENAME } from "../../../test/nodes.harness";
import {
  ADD_VERSION,
  CHANGE,
  NODE_ROLE,
  SHARE,
  sharesArea,
  UNSHARE,
  VERSIONS,
} from "../../../test/shares.harness";

const files = filesWorld();

type Standing = "owner" | "editor" | "viewer" | "team" | "stranger";
const standings: Standing[] = ["owner", "editor", "viewer", "team", "stranger"];
const reads: Record<Standing, boolean> = {
  owner: true,
  editor: true,
  viewer: true,
  team: true,
  stranger: false,
};
const writes: Record<Standing, boolean> = {
  owner: true,
  editor: true,
  viewer: false,
  team: false,
  stranger: false,
};
const LIST = `query($parentId: ID!) { nodes(parentId: $parentId) { nodes { id } } }`;

describe("the effective role, over owner, editor, viewer, team member and stranger", () => {
  test.each(standings)("%s: Node.myRole and what a read shows", async (who) => {
    const a = await sharesArea(files);
    const result = await a.sendAs(a.users[who], NODE_ROLE, { id: a.file.id });
    if (!reads[who]) {
      expect(a.w.codeOf(result)).toBe("nodes.errors.not-found");
      return;
    }
    const node = result.data?.["node"];
    const roles: Record<Standing, string> = {
      owner: "OWNER",
      editor: "EDITOR",
      viewer: "VIEWER",
      team: "VIEWER",
      stranger: "NONE",
    };
    const role = roles[who];
    expect(node.myRole).toBe(role);
    // Only an owner or an editor sees the shares on the node itself.
    const own = await a.sendAs(a.users[who], NODE_ROLE, { id: a.folder.id });
    expect(own.data?.["node"].grants.length).toBe(writes[who] ? 3 : 0);
  });

  test.each(standings)("%s: lists a shared folder", async (who) => {
    const a = await sharesArea(files);
    const result = await a.sendAs(a.users[who], LIST, {
      parentId: a.folder.id,
    });
    if (reads[who]) {
      expect(result.data?.["nodes"].nodes).toHaveLength(1);
    } else {
      expect(a.w.codeOf(result)).toBe("nodes.errors.not-found");
    }
  });

  test.each(standings)(
    "%s: creates, renames and moves inside it",
    async (who) => {
      const a = await sharesArea(files);
      const user = a.users[who];
      const create = await a.sendAs(user, CREATE, {
        parentId: a.folder.id,
        name: `by-${who}`,
      });
      const rename = await a.sendAs(user, RENAME, {
        id: a.file.id,
        name: `renamed-${who}.txt`,
        version: a.file.version,
      });
      const other = await a.owner.folder(a.folder.id, "Other");
      const move = await a.sendAs(user, MOVE, {
        ids: [a.file.id],
        parentId: other.id,
      });
      for (const result of [create, rename, move]) {
        if (writes[who]) expect(result.errors).toBeUndefined();
        else expect(a.w.codeOf(result)).toBe("nodes.errors.not-found");
      }
    },
  );

  test.each(standings)("%s: trashes a shared node", async (who) => {
    const a = await sharesArea(files);
    const result = await a.trash(a.users[who], a.file.id);
    if (writes[who]) expect(result.errors).toBeUndefined();
    else expect(a.w.codeOf(result)).toBe("nodes.errors.not-found");
  });

  test.each(standings)("%s: reads /media and the versions", async (who) => {
    const a = await sharesArea(files);
    const media = await a.media(a.users[who], a.file.key);
    expect(media.status).toBe(reads[who] ? 200 : 404);
    const versions = await a.sendAs(a.users[who], VERSIONS, { id: a.file.id });
    if (reads[who]) {
      expect(versions.data?.["node"].versions.length).toBeGreaterThan(0);
    } else {
      expect(a.w.codeOf(versions)).toBe("nodes.errors.not-found");
    }
  });

  test.each(standings)("%s: adds a version", async (who) => {
    const a = await sharesArea(files);
    const up = await files.upload(a.workspace.owner, a.workspace.id, "v2");
    const result = await a.sendAs(a.users[who], ADD_VERSION, {
      fileId: a.file.id,
      key: up.key,
    });
    if (writes[who]) expect(result.errors).toBeUndefined();
    else expect(a.w.codeOf(result)).toBe("nodes.errors.not-found");
  });

  test.each(standings)("%s: shares, changes and ends a grant", async (who) => {
    const a = await sharesArea(files);
    const user = a.users[who];
    const share = await a.sendAs(user, SHARE, {
      id: a.folder.id,
      principal: { type: "MEMBER", id: a.strangerId },
      role: "VIEWER",
    });
    if (!writes[who]) {
      // A reader of the node is told only owners and editors share; a
      // stranger finds no node.
      const code =
        who === "stranger"
          ? "shares.errors.not-found"
          : "shares.errors.owner-only";
      expect(a.w.codeOf(share)).toBe(code);
      return;
    }
    const grantId = share.data?.["shareNode"].id;
    const change = await a.sendAs(user, CHANGE, {
      id: a.folder.id,
      grantId,
      role: "EDITOR",
    });
    expect(change.data?.["changeGrant"].role).toBe("EDITOR");
    const end = await a.sendAs(user, UNSHARE, { id: a.folder.id, grantId });
    expect(end.errors).toBeUndefined();
  });
});

describe("a revoked grant", () => {
  test("is a 404 on the next read, for the node and for /media", async () => {
    const a = await sharesArea(files);
    const before = await a.sendAs(a.users.viewer, NODE_ROLE, { id: a.file.id });
    expect(before.errors).toBeUndefined();
    expect((await a.media(a.users.viewer, a.file.key)).status).toBe(200);
    const end = await a.sendAs(a.workspace.owner, UNSHARE, {
      id: a.folder.id,
      grantId: a.grants.viewer.id,
    });
    expect(end.errors).toBeUndefined();
    const after = await a.sendAs(a.users.viewer, NODE_ROLE, { id: a.file.id });
    expect(a.w.codeOf(after)).toBe("nodes.errors.not-found");
    expect((await a.media(a.users.viewer, a.file.key)).status).toBe(404);
  });

  test("a team grant ends with the team's grant, not the member's other standing", async () => {
    const a = await sharesArea(files);
    await a.sendAs(a.workspace.owner, UNSHARE, {
      id: a.folder.id,
      grantId: a.grants.team.id,
    });
    const after = await a.sendAs(a.users.team, NODE_ROLE, { id: a.file.id });
    expect(a.w.codeOf(after)).toBe("nodes.errors.not-found");
  });
});
