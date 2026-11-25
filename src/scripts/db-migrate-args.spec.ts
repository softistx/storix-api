import { describe, expect, test } from "bun:test";
import { parseMode } from "./db-migrate-args";

describe("parseMode", () => {
  test("no flag applies what is pending", () => {
    expect(parseMode([])).toEqual({ kind: "apply", dryRun: false });
  });
  test("--dry-run previews an apply", () => {
    expect(parseMode(["--dry-run"])).toEqual({ kind: "apply", dryRun: true });
  });
  test("--status prints the states only", () => {
    expect(parseMode(["--status"])).toEqual({ kind: "status" });
  });
  test("--rollback-to takes the id after it", () => {
    expect(parseMode(["--rollback-to", "2026-01-01-a"])).toEqual({
      kind: "rollback",
      to: "2026-01-01-a",
      dryRun: false,
    });
  });
  test("--rollback-to with --dry-run, in either order, previews the rollback", () => {
    const expected = { kind: "rollback", to: "x", dryRun: true } as const;
    expect(parseMode(["--rollback-to", "x", "--dry-run"])).toEqual(expected);
    expect(parseMode(["--dry-run", "--rollback-to", "x"])).toEqual(expected);
  });
  test("a rollback wins over --status", () => {
    expect(parseMode(["--status", "--rollback-to", "x"]).kind).toBe("rollback");
  });
  test("--rollback-to without an id is refused", () => {
    expect(() => parseMode(["--rollback-to"])).toThrow("needs an id");
    expect(() => parseMode(["--rollback-to", "--dry-run"])).toThrow(
      "needs an id",
    );
  });
});
