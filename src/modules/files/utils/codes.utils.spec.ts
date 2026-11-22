import { describe, expect, test } from "bun:test";
import { hasCode, isNameTaken, isQuotaExceeded } from "./codes.utils";

const coded = (code: string) => ({ extensions: { code } });

describe("hasCode", () => {
  test("matches the code the error carries", () => {
    expect(hasCode("a.b")(coded("a.b"))).toBe(true);
    expect(hasCode("a.b")(coded("a.c"))).toBe(false);
  });

  test("answers false for an error with no extensions", () => {
    expect(hasCode("a.b")(new Error("plain"))).toBe(false);
  });
});

describe("the module's code checks", () => {
  test("name each catalogue code", () => {
    expect(isQuotaExceeded(coded("quotas.errors.exceeded"))).toBe(true);
    expect(isNameTaken(coded("nodes.errors.name-taken"))).toBe(true);
    expect(isNameTaken(coded("quotas.errors.exceeded"))).toBe(false);
  });
});
