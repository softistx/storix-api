import { describe, expect, test } from "bun:test";
import type { Auditor } from "@/core/audit";
import { auditOf } from "./session.utils";

describe("auditOf", () => {
  test("says who and where an audit event is about", () => {
    const audit = {} as Auditor;
    const done = auditOf(
      { ip: "1.2.3.4", audit },
      { core: {}, tenant: { id: "w1" } },
      { accountId: "a1", name: "Ada" },
    );
    expect(done.workspaceId).toBe("w1");
    expect(done.ip).toBe("1.2.3.4");
    expect(done.auditor).toBe(audit);
    expect(done.actor).toBeDefined();
  });
});
