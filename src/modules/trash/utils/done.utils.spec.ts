import { describe, expect, test } from "bun:test";
import type { Auditor } from "@/core/audit";
import { doneBy } from "./done.utils";

describe("doneBy", () => {
  test("carries the workspace, the request's address and its auditor", () => {
    const audit = {} as Auditor;
    const done = doneBy({ ip: "1.2.3.4", audit }, "w1", {
      accountId: "a1",
      name: "Ada",
    });
    expect(done).toMatchObject({
      workspaceId: "w1",
      ip: "1.2.3.4",
      auditor: audit,
    });
    expect(done.actor).toBeDefined();
  });
});
