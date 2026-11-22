import { describe, expect, test } from "bun:test";
import type { FilesMongo } from "../models";
import { counted, sessionOf } from "./accounting.utils";

describe("counted", () => {
  test("counts nothing for a blob that is not held", () => {
    expect(counted(undefined)).toEqual({
      bytes: 0,
      versionBytes: 0,
      trashBytes: 0,
    });
    expect(counted({ size: 5, state: "none" }).bytes).toBe(0);
  });

  test("counts a live blob in bytes only", () => {
    expect(counted({ size: 5, state: "live" })).toEqual({
      bytes: 5,
      versionBytes: 0,
      trashBytes: 0,
    });
  });

  test("counts a trashed or version-only blob in its own part too", () => {
    expect(counted({ size: 5, state: "trash" })).toEqual({
      bytes: 5,
      versionBytes: 0,
      trashBytes: 5,
    });
    expect(counted({ size: 5, state: "versions" })).toEqual({
      bytes: 5,
      versionBytes: 5,
      trashBytes: 0,
    });
  });
});

describe("sessionOf", () => {
  const within = (session: unknown) =>
    ({ db: { nodes: { session } } }) as unknown as FilesMongo;

  test("carries the transaction's session, or nothing outside one", () => {
    const session = { id: 1 } as never;
    expect(sessionOf(within(session))).toEqual({ session });
    expect(sessionOf(within(undefined))).toEqual({});
  });
});
