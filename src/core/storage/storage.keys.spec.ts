import { describe, expect, test } from "bun:test";
import { mayReadFile, onFileRead } from "./storage.keys";

describe("storage keys", () => {
  test("the registered check decides", async () => {
    onFileRead(async (_mongo, read) => read.key === "yes");
    expect(await mayReadFile({}, { key: "yes", accountId: "a" })).toBe(true);
    expect(await mayReadFile({}, { key: "no", accountId: "a" })).toBe(false);
  });
});
