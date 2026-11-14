import { describe, expect, test } from "bun:test";
import type { Db } from "mongodb";
import { textStore } from "./translations.store";

interface UpdateOne {
  filter: unknown;
  update: { $set: { text: string }; $setOnInsert: { createdAt: Date } };
  upsert: boolean;
}

function fakeDb() {
  const calls: { bulk?: unknown[]; filter?: unknown; options?: unknown } = {};
  const db = {
    collection: () => ({
      bulkWrite: async (ops: unknown[], options: unknown) => {
        calls.bulk = ops;
        calls.options = options;
      },
      deleteMany: async (filter: unknown, options: unknown) => {
        calls.filter = filter;
        calls.options = options;
      },
    }),
  } as unknown as Db;
  return { db, calls };
}

describe("textStore", () => {
  test("upsert writes the key to the Mongo field `code`, stamping createdAt on insert", async () => {
    const { db, calls } = fakeDb();
    await textStore(db, undefined).upsert([
      { key: "a.errors.x", language: "en", text: "X" },
    ]);
    const [first] = calls.bulk as { updateOne: UpdateOne }[];
    const op = first?.updateOne;
    expect(op?.filter).toEqual({ code: "a.errors.x", language: "en" });
    expect(op?.update.$set.text).toBe("X");
    expect(op?.update.$setOnInsert.createdAt).toBeInstanceOf(Date);
    expect(op?.upsert).toBe(true);
  });

  test("upsert of no rows writes nothing", async () => {
    const { db, calls } = fakeDb();
    await textStore(db, undefined).upsert([]);
    expect(calls.bulk).toBeUndefined();
  });

  test("remove filters on `code`", async () => {
    const { db, calls } = fakeDb();
    await textStore(db, undefined).remove(["a.errors.x"]);
    expect(calls.filter).toEqual({ code: { $in: ["a.errors.x"] } });
  });
});
