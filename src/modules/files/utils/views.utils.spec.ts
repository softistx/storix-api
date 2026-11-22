import { describe, expect, test } from "bun:test";
import type { NodeDoc } from "@/modules/nodes/public";
import type { PersonalPage } from "../services";
import { fileOf, pageOf } from "./views.utils";

describe("pageOf", () => {
  const page = { items: [], endCursor: "c1" } as unknown as PersonalPage;

  test("says there is more when a cursor goes on", () => {
    expect(pageOf(page, null).pageInfo).toEqual({
      startCursor: null,
      endCursor: "c1",
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });

  test("has a previous page after a cursor and no next at the end", () => {
    const last = { items: [], endCursor: null } as unknown as PersonalPage;
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
