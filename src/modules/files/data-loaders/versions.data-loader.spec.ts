import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import { filesWorld } from "../../../../test/files.harness";
import { versionsArea } from "../../../../test/versions.harness";
import * as services from "../services";
import { listVersionsBatch, type VersionsOfFile } from "../services";

const files = filesWorld();
let a: Awaited<ReturnType<typeof versionsArea>>;
beforeAll(async () => {
  a = await versionsArea(files);
});

const LISTING = `query($parentId: ID!) { nodes(parentId: $parentId, first: 100) { nodes { id ... on File { versions { number current } } } } }`;

describe("File.versions loader", () => {
  test("a listing reads the versions of all its files in one batch", async () => {
    const f1 = await a.add("a.txt", "a");
    const f2 = await a.add("b.txt", "b");
    await a.push(f2.id, "bb");
    const batches = spyOn(services, "listVersionsBatch");
    const result = await a.send(LISTING, { parentId: a.root.id });
    expect(result.errors).toBeUndefined();
    const nodes = (
      result.data as unknown as {
        nodes: {
          nodes: { id: string; versions: { number: number }[] | undefined }[];
        };
      }
    ).nodes.nodes;
    // One batch for the request, holding every file of the page.
    expect(batches.mock.calls).toHaveLength(1);
    expect(batches.mock.calls[0]?.[1].ids).toEqual(
      expect.arrayContaining([f1.id, f2.id]),
    );
    batches.mockRestore();
    const counts = new Map(nodes.map((n) => [n.id, n.versions?.length]));
    expect(counts.get(f1.id)).toBe(1);
    expect(counts.get(f2.id)).toBe(2);
  });

  test("one answer per file, a folder or an unknown id failing alone", async () => {
    const mine = await a.add("mine.txt", "m");
    const accountId = a.owner.principal.accountId;
    const [ok, folder, unknown] = await listVersionsBatch(a.mongo, {
      ids: [mine.id, a.root.id, "0".repeat(24)],
      accountId,
    });
    expect((ok as VersionsOfFile).rows).toHaveLength(1);
    expect((ok as VersionsOfFile).currentId).toBe(
      (ok as VersionsOfFile).rows[0]?.id ?? null,
    );
    expect(folder).toBeInstanceOf(Error);
    expect(unknown).toBeInstanceOf(Error);
    const other = await a.w.h.account();
    const [theirs] = await listVersionsBatch(a.mongo, {
      ids: [mine.id],
      accountId: other.principal.accountId,
    });
    expect(theirs).toBeInstanceOf(Error);
  });
});
