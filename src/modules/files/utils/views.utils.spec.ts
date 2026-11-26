import { describe, expect, test } from "bun:test";
import type { NodeDoc } from "@/modules/nodes/public";
import type { PersonalPage } from "../services";
import { fileOf, pageOf, recentPageOf } from "./views.utils";

describe("pageOf", () => {
  const page = {
    items: [],
    dates: [],
    endCursor: "c1",
  } as unknown as PersonalPage;

  test("says there is more when a cursor goes on", () => {
    expect(pageOf(page, null).pageInfo).toEqual({
      startCursor: null,
      endCursor: "c1",
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });

  test("has a previous page after a cursor and no next at the end", () => {
    const last = {
      items: [],
      dates: [],
      endCursor: null,
    } as unknown as PersonalPage;
    expect(pageOf(last, "c0").pageInfo).toMatchObject({
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });
});

describe("fileOf", () => {
  test("refuses a folder with not-a-file", () => {
    const folder = {
      type: "FOLDER",
      id: "f1",
      name: "d",
    } as unknown as NodeDoc;
    expect(() => fileOf(folder)).toThrow();
  });
});

describe("recentPageOf", () => {
  test("pairs each file with its open time and keeps the paging", () => {
    const at = new Date("2026-11-20T10:00:00Z");
    const file = {
      type: "FILE",
      id: "f1",
      name: "a.txt",
      ancestors: [],
    } as unknown as NodeDoc;
    const page = {
      items: [file],
      dates: [at],
      endCursor: null,
    } as unknown as PersonalPage;
    const view = recentPageOf(page, "c0");
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]?.openedAt).toBe(at);
    expect(view.entries[0]?.node).toMatchObject({ id: "f1", name: "a.txt" });
    expect(view.pageInfo.hasPreviousPage).toBe(true);
  });
});
