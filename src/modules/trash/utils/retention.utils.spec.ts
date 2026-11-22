import { describe, expect, test } from "bun:test";
import { isSettled } from "./retention.utils";

const coded = (code: string) => ({ extensions: { code } });

describe("isSettled", () => {
  test("an entry gone or restored meanwhile is settled", () => {
    expect(isSettled(coded("nodes.errors.not-found"))).toBe(true);
    expect(isSettled(coded("trash.errors.not-trashed"))).toBe(true);
  });

  test("any other failure is not", () => {
    expect(isSettled(coded("nodes.errors.conflict"))).toBe(false);
    expect(isSettled(new Error("boom"))).toBe(false);
    expect(isSettled(undefined)).toBe(false);
  });
});
