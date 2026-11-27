import { describe, expect, test } from "bun:test";
import type { NodeDoc } from "../models";
import { cropsStatusOf, fileView, nodePage, nodeView } from "./views.utils";

const at = (hex: string) => ({ toHexString: () => hex });
const base = {
  id: "n1",
  name: "a",
  parentId: at("p1"),
  ancestors: [at("r"), at("p1")],
  version: 2,
};

describe("nodeView", () => {
  test("a folder is a Folder with its depth and ancestors", () => {
    const view = nodeView({ ...base, type: "FOLDER" } as unknown as NodeDoc);
    expect(view).toMatchObject({
      __typename: "Folder",
      parentId: "p1",
      ancestors: ["r", "p1"],
      depth: 3,
      trashedAt: null,
    });
  });

  test("a file is a File, with defaults for what the storage lacks", () => {
    const view = nodeView({ ...base, type: "FILE" } as unknown as NodeDoc);
    expect(view).toMatchObject({
      __typename: "File",
      key: "",
      mimeType: "application/octet-stream",
      size: 0,
      family: "OTHER",
      status: "READY",
    });
  });

  test("fileView answers a File whatever the type says", () => {
    const view = fileView({ ...base, type: "FOLDER" } as unknown as NodeDoc);
    expect(view.__typename).toBe("File");
  });
});

describe("nodePage", () => {
  const item = { ...base, type: "FOLDER" } as unknown as NodeDoc;

  test("a page with more after it carries its end cursor", () => {
    const out = nodePage({ items: [item], endCursor: "c" }, "prev");
    expect(out.nodes).toHaveLength(1);
    expect(out.pageInfo).toEqual({
      startCursor: null,
      endCursor: "c",
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  test("the last page of a first read has neither neighbour", () => {
    const out = nodePage({ items: [], endCursor: null }, undefined);
    expect(out.pageInfo.hasNextPage).toBe(false);
    expect(out.pageInfo.hasPreviousPage).toBe(false);
  });
});

describe("cropsStatusOf", () => {
  const of = (status: string, cropsStatus?: string | null) =>
    cropsStatusOf({ status, cropsStatus } as unknown as NodeDoc);

  test("a READY file reads its stored crops status, READY when it has none", () => {
    expect(of("READY")).toBe("READY");
    expect(of("READY", null)).toBe("READY");
    expect(of("READY", "PROCESSING")).toBe("PROCESSING");
    expect(of("READY", "FAILED")).toBe("FAILED");
  });

  test("a file that is not READY mirrors its own status", () => {
    expect(of("PROCESSING", "READY")).toBe("PROCESSING");
    expect(of("FAILED")).toBe("FAILED");
  });

  test("fileView carries it", () => {
    const view = fileView({
      ...base,
      type: "FILE",
      status: "READY",
      cropsStatus: "PROCESSING",
    } as unknown as NodeDoc);
    expect(view.cropsStatus).toBe("PROCESSING");
  });
});
