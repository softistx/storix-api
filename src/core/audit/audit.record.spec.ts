import { describe, expect, spyOn, test } from "bun:test";
import { connection } from "@/config/db";
import { env } from "@/config/env";
import { store } from "@/config/tenancy";
import { world } from "../../../test/workspaces.harness";
import { AUDIT_RETENTION_SECONDS } from "./audit.collection";
import { storedEvents } from "./audit.harness";
import { hashAddress } from "./audit.ip-hash";
import { createAuditor } from "./index";

const ADDRESS = "203.0.113.77";

const audit = createAuditor({
  databaseOf: (id: string) => store.databaseOf(id),
  ipKey: env.AUDIT_IP_KEY,
});

// An auditor whose database is gone.
const broken = createAuditor({
  databaseOf: async () => {
    throw new Error("the database is gone");
  },
  ipKey: env.AUDIT_IP_KEY,
});

const event = (workspaceId: string, extra: Record<string, unknown> = {}) => ({
  workspaceId,
  actor: { type: "MEMBER" as const, id: "account-1", label: "Ada" },
  action: "team.create",
  target: { type: "TEAM", id: "team-1", name: "Design" },
  ...extra,
});

describe("audit.record", () => {
  test("keeps a keyed hash of the address, never the address", async () => {
    const w = await world();
    const { id } = await w.workspaceOf();
    await audit.record(event(id, { ip: ADDRESS }));
    await audit.record(event(id, { ip: ADDRESS }));
    await audit.record(event(id, { ip: "203.0.113.78" }));
    await audit.record(event(id));
    const [, one, two, other, none] = await storedEvents(id);
    expect(one?.ipHash).toBe(hashAddress(env.AUDIT_IP_KEY, ADDRESS));
    expect(one?.ipHash).toMatch(/^[0-9a-f]{64}$/);
    // The same address is the same hash; another address, another one.
    expect(two?.ipHash).toBe(one?.ipHash ?? "");
    expect(other?.ipHash).not.toBe(one?.ipHash ?? "");
    expect(none?.ipHash).toBeNull();
    // The key matters: the hash of the address under another key differs.
    expect(hashAddress("another-key".repeat(4), ADDRESS)).not.toBe(
      one?.ipHash ?? "",
    );
    expect(JSON.stringify(await storedEvents(id))).not.toContain(ADDRESS);
  });

  test("drops a meta key that names a secret", async () => {
    const w = await world();
    const { id } = await w.workspaceOf();
    await audit.record(
      event(id, {
        meta: {
          role: "ADMIN",
          code: "abc",
          inviteToken: "def",
          Password: "ghi",
          linkSecret: "jkl",
        },
      }),
    );
    const events = await storedEvents(id);
    expect(events.at(-1)?.meta).toEqual({ role: "ADMIN" });
  });

  test("a failure to record is logged and never throws", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        broken.record(event("64b7f0c2a1d3e4f5a6b7c8d9")),
      ).resolves.toBeUndefined();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(logged.mock.calls[0]?.[0])).toContain("team.create");
    } finally {
      logged.mockRestore();
    }
  });

  test("a write whose event cannot be recorded still stands", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const w = await world({ audit: broken });
    const workspace = await w.workspaceOf();
    try {
      const made = await w.send(
        workspace.owner,
        'mutation { createTeam(name: "Still here") { id name } }',
        { workspace: workspace.id },
      );
      expect(made.errors).toBeUndefined();
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
    const teams = await w.send(workspace.owner, "{ teams { name } }", {
      workspace: workspace.id,
    });
    expect(teams.data?.["teams"]).toEqual([{ name: "Still here" }]);
  });

  test("the log expires after 365 days and is indexed for its reads", async () => {
    const w = await world();
    const { id } = await w.workspaceOf();
    const indexes = await connection.client
      .db(`${env.MONGO_WORKSPACE_PREFIX}${id}`)
      .collection("auditEvents")
      .indexes();
    const byName = Object.fromEntries(indexes.map((i) => [i.name, i]));
    expect(byName["audit_events_ttl"]?.expireAfterSeconds).toBe(
      AUDIT_RETENTION_SECONDS,
    );
    expect(AUDIT_RETENTION_SECONDS).toBe(365 * 24 * 60 * 60);
    expect(byName["audit_events_at"]?.key).toEqual({ at: -1, _id: -1 });
    expect(byName["audit_events_target"]?.key).toEqual({
      "target.id": 1,
      at: -1,
    });
    expect(byName["audit_events_actor"]?.key).toEqual({
      "actor.id": 1,
      at: -1,
    });
  });
});
