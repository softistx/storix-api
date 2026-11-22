import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { afterPosition } from "./paging.utils";

describe("afterPosition", () => {
  test("is no filter from the start", () => {
    expect(afterPosition("at", null)).toEqual({});
  });

  test("keeps the rows after a position: later, or the same date and a smaller id", () => {
    const after = { date: new Date("2026-01-01"), _id: new ObjectId() };
    expect(afterPosition("at", after)).toEqual({
      $or: [
        { at: { $lt: after.date } },
        { at: after.date, _id: { $lt: after._id } },
      ],
    });
  });
});
