import { describe, expect, test } from "bun:test";
import { reaches, strongest } from "./role.rules";

describe("strongest", () => {
  test("the highest role wins, whatever the order", () => {
    expect(strongest(["VIEWER", "EDITOR"])).toBe("EDITOR");
    expect(strongest(["EDITOR", "VIEWER", "VIEWER"])).toBe("EDITOR");
    expect(strongest(["VIEWER", "OWNER"])).toBe("OWNER");
  });

  test("no role is none", () => {
    expect(strongest([])).toBeNull();
  });
});

describe("reaches", () => {
  test("each role reaches its own level and below", () => {
    expect(reaches("VIEWER", "VIEWER")).toBe(true);
    expect(reaches("VIEWER", "EDITOR")).toBe(false);
    expect(reaches("EDITOR", "VIEWER")).toBe(true);
    expect(reaches("EDITOR", "EDITOR")).toBe(true);
    expect(reaches("EDITOR", "OWNER")).toBe(false);
    expect(reaches("OWNER", "EDITOR")).toBe(true);
  });

  test("no role reaches nothing", () => {
    expect(reaches(null, "VIEWER")).toBe(false);
  });
});
