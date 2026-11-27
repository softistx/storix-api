import { describe, expect, test } from "bun:test";
import { filesWorld } from "../../../test/files.harness";
import { setup } from "../../../test/nodes.harness";

const files = filesWorld();

describe("/media reads of `files` by key", () => {
  test("an unrecorded key is 404, a recorded one is read by its owner only", async () => {
    const { w, workspace, owner } = await setup(files.ctx.w);
    const member = await w.join(workspace, "MEMBER");
    const root = await owner.root();
    const read = (user: typeof workspace.owner, key: string) =>
      files.call(user, workspace.id, `/media/files/${key}`);

    const loose = await files.upload(workspace.owner, workspace.id, "loose");
    expect((await read(workspace.owner, loose.key)).status).toBe(404);

    const file = await files.addFile(
      workspace.owner,
      workspace.id,
      root.id,
      "mine.txt",
      "mine",
    );
    expect((await read(workspace.owner, file.key)).status).toBe(200);
    expect((await read(member.user, file.key)).status).toBe(404);
  });
});
