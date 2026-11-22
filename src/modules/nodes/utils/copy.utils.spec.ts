import { describe, expect, test } from "bun:test";
import { copyName } from "./copy.utils";

describe("copyName", () => {
  test("numbers before the extension", () => {
    expect(copyName("report.pdf", 1)).toBe("report (1).pdf");
    expect(copyName("a.tar.gz", 2)).toBe("a.tar (2).gz");
  });
  test("a name with no extension, or a dotfile, is numbered at the end", () => {
    expect(copyName("notes", 3)).toBe("notes (3)");
    expect(copyName(".env", 1)).toBe(".env (1)");
  });
  test("stays within 255 characters", () => {
    const long = `${"x".repeat(300)}.txt`.slice(-255);
    expect(copyName(long, 12).length).toBeLessThanOrEqual(255);
    expect(copyName(long, 12).endsWith(" (12).txt")).toBe(true);
  });
});
