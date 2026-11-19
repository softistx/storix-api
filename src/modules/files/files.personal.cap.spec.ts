import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { filesMongo } from "./files.handle";
import { MAX_READS, personalPage, type Row } from "./files.personal";

// A list whose rows all point at nodes that are gone: the scan stops on its
// cap and hands back a cursor, instead of reading every dead row.
describe("personal lists over dead rows", () => {
  const mongo = filesMongo({
    db: { nodes: { findMany: async () => [] } },
  });

  test("a scan of dead rows stops at MAX_READS and resumes by cursor", async () => {
    let reads = 0;
    const fetch = async (_after: unknown, limit: number): Promise<Row[]> => {
      reads++;
      return Array.from({ length: limit }, () => ({
        _id: new ObjectId(),
        nodeId: new ObjectId(),
        date: new Date(),
      }));
    };
    const page = await personalPage(mongo, {
      scope: "starred",
      accountId: "a",
      first: 10,
      after: null,
      fetch,
      filesOnly: false,
    });
    expect(reads).toBe(MAX_READS);
    expect(page.items).toEqual([]);
    expect(page.endCursor).not.toBeNull();
  });

  test("an exhausted list has no cursor", async () => {
    const page = await personalPage(mongo, {
      scope: "starred",
      accountId: "a",
      first: 10,
      after: null,
      fetch: async () => [],
      filesOnly: false,
    });
    expect(page.endCursor).toBeNull();
  });
});

// The same scan with a node that is alive among the dead rows: the page keeps
// it and still hands back the cursor, since the cap stopped the scan. The
// database is a handle built over a stub, not a cast.
describe("personal lists with live rows before the cap", () => {
  test("a capped scan keeps the live rows it found and resumes by cursor", async () => {
    const live = new ObjectId();
    const handle = filesMongo({
      db: {
        nodes: {
          findMany: async ({
            filter,
          }: {
            filter: { _id: { $in: ObjectId[] } };
          }) =>
            filter._id.$in.some((id) => id.equals(live))
              ? [{ id: live.toHexString() }]
              : [],
        },
      },
    });
    let reads = 0;
    const fetch = async (_after: unknown, limit: number): Promise<Row[]> => {
      reads++;
      return Array.from({ length: limit }, (_, index) => ({
        _id: new ObjectId(),
        nodeId: reads === 1 && index === 0 ? live : new ObjectId(),
        date: new Date(),
      }));
    };
    const page = await personalPage(handle, {
      scope: "starred",
      accountId: "a",
      first: 10,
      after: null,
      fetch,
      filesOnly: false,
    });
    expect(reads).toBe(MAX_READS);
    expect(page.items.map((node) => node.id)).toEqual([live.toHexString()]);
    expect(page.endCursor).not.toBeNull();
  });
});
