import { describe, expect, test } from "bun:test";
import {
  after,
  escapeRegex,
  familiesOf,
  filterOf,
  orderOf,
  pageNodes,
} from "./list.utils";

describe("escapeRegex", () => {
  test("escapes what a regex reads as syntax", () => {
    expect(escapeRegex("a.b*c(d)")).toBe("a\\.b\\*c\\(d\\)");
  });
});

describe("familiesOf", () => {
  test("keeps the known families, once each", () => {
    expect(familiesOf(["IMAGE", "IMAGE", "NOPE", "PDF"])).toEqual([
      "IMAGE",
      "PDF",
    ]);
    expect(familiesOf(null)).toEqual([]);
  });
});

describe("filterOf", () => {
  test("is the live children when nothing narrows it", () => {
    expect(filterOf("p", [], [], "")).toEqual([
      { parentId: "p", trashedAt: null },
    ]);
  });

  test("adds one clause per family, tags and name", () => {
    expect(filterOf("p", ["IMAGE"], ["a"], "x.y")).toEqual([
      { parentId: "p", trashedAt: null },
      { family: { $in: ["IMAGE"] } },
      { tags: { $all: ["a"] } },
      { name: { $regex: "x\\.y", $options: "i" } },
    ]);
  });
});

describe("orderOf", () => {
  test("puts folders first and ends with the id", () => {
    expect(orderOf("SIZE", -1)).toEqual([
      { key: "type", dir: -1 },
      { key: "size", dir: -1 },
      { key: "name", dir: -1 },
      { key: "_id", dir: -1 },
    ]);
  });
});

describe("after", () => {
  test("is one branch per position, equal before and further on the last", () => {
    const order = [
      { key: "type", dir: -1 as const },
      { key: "name", dir: 1 as const },
    ];
    expect(after(order, ["FOLDER", "b"])).toEqual([
      { type: { $lt: "FOLDER" } },
      { type: "FOLDER", name: { $gt: "b" } },
    ]);
  });

  test("a null position has nothing beyond it", () => {
    const order = [{ key: "size", dir: 1 as const }];
    expect(after(order, [null])).toEqual([]);
  });
});

describe("pageNodes", () => {
  const rows = [{ name: "a" }, { name: "b" }, { name: "c" }];
  const find = async (query: { limit: number }) => rows.slice(0, query.limit);
  const page = (first: number, after?: string | null) => ({
    base: [{}],
    order: orderOf("NAME", 1).slice(0, 2),
    scope: "s",
    first,
    after,
  });

  test("keeps `first` nodes and a cursor when more follow", async () => {
    const out = await pageNodes(find as never, page(2));
    expect(out.items).toEqual([{ name: "a" }, { name: "b" }]);
    expect(out.endCursor).not.toBeNull();
  });

  test("has no cursor on the last page", async () => {
    const out = await pageNodes(find as never, page(3));
    expect(out.items).toHaveLength(3);
    expect(out.endCursor).toBeNull();
  });

  test("refuses a cursor of another scope", async () => {
    const out = await pageNodes(find as never, page(2));
    const wrong = { ...page(2, out.endCursor), scope: "other" };
    await expect(pageNodes(find as never, wrong)).rejects.toThrow();
  });
});
