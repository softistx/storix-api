import { describe, expect, test } from "bun:test";
import { actionsOf, storedEvents } from "@/core/audit/audit.harness";
import { code, field } from "../../../../test/files.area";
import { FOCAL, focalKit, READ } from "../../../../test/files.focal.harness";
import { COPY, filesWorld } from "../../../../test/files.harness";

const files = filesWorld({ renditions: true });
const { area, settled } = focalKit(files);

describe("focal point rules", () => {
  test("a copy shares the point; the move is audited without its values", async () => {
    const a = await area();
    const file = await a.record("shared.png");
    await settled(a.workspace.id, file.key);
    const dir = await a.owner.folder(a.root.id, "dir");
    const copied = await a.send(COPY, { ids: [file.id], parentId: dir.id });
    const [copy] = field<{ id: string }[]>(copied, "copyNodes");
    await a.send(FOCAL, { id: file.id, focalPoint: { x: 0.9, y: 0.1 } });
    await settled(a.workspace.id, file.key);
    const read = await a.send(READ, { id: copy?.id });
    expect(field<{ focalPoint: unknown }>(read, "node").focalPoint).toEqual({
      x: 0.9,
      y: 0.1,
    });
    const events = await storedEvents(a.workspace.id);
    expect(actionsOf(events)).toContain("file.focal");
    const event = events.find((one) => one.action === "file.focal");
    expect(event?.target?.name).toBe("shared.png");
    expect(JSON.stringify(event)).not.toContain("0.9");
  });

  test("a folder, a non-picture and a bad point are refused", async () => {
    const a = await area();
    const dir = await a.owner.folder(a.root.id, "dir");
    expect(
      code(await a.send(FOCAL, { id: dir.id, focalPoint: { x: 0, y: 0 } })),
    ).toBe("files.errors.not-a-file");
    const text = await a.record(
      "a.txt",
      new TextEncoder().encode("hello"),
      "text/plain",
    );
    expect(
      code(await a.send(FOCAL, { id: text.id, focalPoint: { x: 0, y: 0 } })),
    ).toBe("files.errors.not-renderable");
    const file = await a.record("p.png");
    await settled(a.workspace.id, file.key);
    for (const focalPoint of [
      { x: 1.01, y: 0.5 },
      { x: 0.5, y: -0.1 },
    ]) {
      const refused = await a.send(FOCAL, { id: file.id, focalPoint });
      expect(code(refused)).toBe("files.errors.invalid-focal");
    }
    // Nothing moved, nothing queued: the file is still READY.
    const read = await a.send(READ, { id: file.id });
    expect(field<{ focalPoint: unknown }>(read, "node").focalPoint).toBeNull();
    expect(await settled(a.workspace.id, file.key)).toBe("READY");
  });

  test("a node of another workspace is not found", async () => {
    const a = await area();
    const file = await a.record("p.png");
    const other = await files.ctx.w.workspaceOf();
    const result = await files.ctx.w.send(other.owner, FOCAL, {
      workspace: other.id,
      variables: { id: file.id, focalPoint: { x: 0, y: 0 } },
    });
    expect(code(result)).toBe("nodes.errors.not-found");
  });
});
