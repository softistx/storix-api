import { describe, expect, test } from "bun:test";
import {
  catalogueOf,
  messageIn,
  messagesOf,
  stableJson,
  versionOf,
} from "./translations.catalogue";

const rows = [
  { code: "a.errors.one", language: "en", text: "One" },
  { code: "a.errors.one", language: "fr", text: "Un" },
  { code: "a.errors.two", language: "en", text: "Two" },
];

describe("catalogueOf", () => {
  test("nests the dotted codes of one language", () => {
    expect(catalogueOf(rows, "fr")).toEqual({ a: { errors: { one: "Un" } } });
    expect(messageIn(catalogueOf(rows, "en"), "a.errors.two")).toBe("Two");
  });

  test("refuses a code that is also a branch", () => {
    const clash = [...rows, { code: "a.errors", language: "en", text: "x" }];
    expect(() => catalogueOf(clash, "en")).toThrow(
      "both a message and a branch",
    );
  });

  test("refuses a prototype key", () => {
    const bad = [{ code: "a.__proto__.x", language: "en", text: "x" }];
    expect(() => catalogueOf(bad, "en")).toThrow();
  });
});

describe("messagesOf", () => {
  test("fills a missing text from the next catalogue of the chain, in code order", () => {
    const chain = [catalogueOf(rows, "fr"), catalogueOf(rows, "en")];
    expect(
      messagesOf(chain, ["a.errors.two", "a.errors.one", "a.errors.zero"]),
    ).toEqual([
      { code: "a.errors.two", message: "Two" },
      { code: "a.errors.one", message: "Un" },
    ]);
  });
});

describe("versionOf", () => {
  const en = catalogueOf(rows, "en");

  test("is the same for the same texts whatever the order they were built in", () => {
    const shuffled = catalogueOf([...rows].reverse(), "en");
    expect(versionOf([shuffled])).toBe(versionOf([en]));
    expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }));
  });

  test("changes with a text, and with the fallback's", () => {
    const reworded = catalogueOf(
      rows.map((row) =>
        row.code === "a.errors.two" ? { ...row, text: "Deux" } : row,
      ),
      "en",
    );
    expect(versionOf([reworded])).not.toBe(versionOf([en]));
    expect(versionOf([catalogueOf(rows, "fr"), en])).not.toBe(
      versionOf([catalogueOf(rows, "fr"), reworded]),
    );
  });
});
