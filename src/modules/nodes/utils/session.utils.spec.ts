import { describe, expect, test } from "bun:test";
import type { NodesMongo } from "../models";
import { sessionOf } from "./session.utils";

const txOf = (session: unknown) =>
  ({ db: { nodes: { session } } }) as unknown as NodesMongo;

describe("sessionOf", () => {
  test("carries the transaction's session as an option", () => {
    const session = { id: "s" } as never;
    expect(sessionOf(txOf(session))).toEqual({ session });
  });

  test("is empty outside a transaction", () => {
    expect(sessionOf(txOf(undefined))).toEqual({});
  });
});
