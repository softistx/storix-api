import { describe, expect, test } from "bun:test";
import type { FilesMongo } from "@/modules/files/public";
import { inSession } from "./session.utils";

const txOf = (session: unknown) =>
  ({ db: { nodes: { session } } }) as unknown as FilesMongo;

describe("inSession", () => {
  test("carries the transaction's session as an option", () => {
    const session = { id: "s" } as never;
    expect(inSession(txOf(session))).toEqual({ session });
  });

  test("is empty outside a transaction", () => {
    expect(inSession(txOf(undefined))).toEqual({});
  });
});
