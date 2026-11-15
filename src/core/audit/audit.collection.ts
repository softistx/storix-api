import { defineCollection, id } from "@softistx/mongo";
import { z } from "zod";

// Who did it. `MEMBER` is a signed-in account; `API_KEY`, `TOKEN` and `LINK`
// are the callers of the files epics (E1 records members only). `label` is the
// name the actor had at the time, so the log reads after the account is gone.
export const auditActorTypes = ["MEMBER", "API_KEY", "TOKEN", "LINK"] as const;

// What `meta` may hold: short scalars, never a structure that could carry a
// secret by accident.
const metaValue = z.union([z.string().max(200), z.number(), z.boolean()]);

// The workspace's audit log, in the workspace's own database. Append-only: the
// module only ever inserts, no field of it updates or deletes an event, and
// the TTL index is what removes one, after a year (plan §3.3). `ipHash` is a
// keyed hash of the address (audit.ip-hash.ts), never the address.
export const AUDIT_RETENTION_SECONDS = 365 * 24 * 60 * 60;

export const auditEvents = defineCollection({
  name: "auditEvents",
  schema: z.object({
    _id: id(),
    at: z.date(),
    actor: z.object({
      type: z.enum(auditActorTypes),
      id: z.string().min(1),
      label: z.string().nullable().default(null),
    }),
    action: z.string().min(1).max(60),
    target: z.object({
      type: z.string().min(1).max(40),
      id: z.string().min(1),
      name: z.string().nullable().default(null),
    }),
    ipHash: z.string().nullable().default(null),
    meta: z.record(z.string(), metaValue).default({}),
  }),
  indexes: [
    { key: { at: -1, _id: -1 }, name: "audit_events_at" },
    { key: { "target.id": 1, at: -1 }, name: "audit_events_target" },
    { key: { "actor.id": 1, at: -1 }, name: "audit_events_actor" },
    {
      key: { at: 1 },
      expireAfterSeconds: AUDIT_RETENTION_SECONDS,
      name: "audit_events_ttl",
    },
  ],
});
