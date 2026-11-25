import { describe, expect, test } from "bun:test";
import { notificationNotFound, notifications } from "./notifications.errors";

describe("the notifications codes", () => {
  test("not-found is a 404 under its own prefix", () => {
    expect(notifications).toContain("notifications.errors.not-found");
    expect(notificationNotFound().extensions).toMatchObject({
      code: "notifications.errors.not-found",
      http: { status: 404 },
    });
  });
});
