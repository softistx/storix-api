import { describe, expect, test } from "bun:test";
import { declaredCodes, missingCodes } from "./context-codes-check";

describe("context codes check", () => {
  test("lists the codes a defineCodes call declares", () => {
    expect(
      declaredCodes('defineCodes("issues", ["not-found", "locked"])'),
    ).toEqual(["issues.errors.not-found", "issues.errors.locked"]);
  });

  test("names the codes CONTEXT.md lacks", () => {
    const context =
      "| `issues.errors.` `locked` | x |\n| `members.errors.` `gone` | y |";
    expect(
      missingCodes(
        ["issues.errors.locked", "members.errors.gone", "teams.errors.full"],
        context,
      ),
    ).toEqual(["teams.errors.full"]);
  });
});
