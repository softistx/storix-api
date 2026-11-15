import { afterAll, describe, expect, test } from "bun:test";
import { type FileReader, mayReadFile, onFileRead } from "./storage.keys";

let registered: FileReader | undefined;
// The files module registers its check when it loads: put it back afterwards,
// the other specs of the run read through it.
afterAll(() => {
  onFileRead(registered);
});

describe("storage keys", () => {
  test("the registered check decides", async () => {
    registered = onFileRead(async (_mongo, read) => read.key === "yes");
    expect(await mayReadFile({}, { key: "yes", accountId: "a" })).toBe(true);
    expect(await mayReadFile({}, { key: "no", accountId: "a" })).toBe(false);
  });
});
