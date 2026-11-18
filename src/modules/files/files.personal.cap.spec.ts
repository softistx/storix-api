import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import type { FilesMongo } from "./files.handle";
import { MAX_READS, personalPage, type Row } from "./files.personal";

// A list whose rows all point at nodes that are gone: the scan stops on its
// cap and hands back a cursor, instead of reading every dead row.
describe("personal lists over dead rows", () => {
  const mongo = {
    db: { nodes: { findMany: async () => [] } },
  } as unknown as FilesMongo;

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
