import type { CollectionsOf, ModuleHandle } from "@alxia/modules";
import type { Mongo } from "@softistx/mongo";
import type { auditActorTypes } from "./audit.collection";
import { hashAddress } from "./audit.ip-hash";

// The module's handle on a workspace's database: its own collection only.
export type AuditMongo = ModuleHandle<
  "audit",
  Mongo<{ collections: CollectionsOf }>
>;

export type AuditActor = {
  type: (typeof auditActorTypes)[number];
  id: string;
  label?: string | null;
};

export type AuditMeta = Record<string, string | number | boolean>;

// One thing that happened, as a module says it. `ip` is the request's raw
// address: the port hashes it and drops it, so it never reaches the database.
export interface AuditEventInput {
  workspaceId: string;
  actor: AuditActor;
  // `<area>.<verb>`: `member.role-change`, `team.create`.
  action: string;
  target: { type: string; id: string; name?: string | null };
  ip?: string | null | undefined;
  meta?: AuditMeta;
}

// The actor of an event done by a signed-in account.
export const memberActor = (principal: {
  accountId: string;
  name: string;
}): AuditActor => ({
  type: "MEMBER",
  id: principal.accountId,
  label: principal.name,
});

// Where events go and what hashes the address: bound once by the server's
// wiring (src/config/tenancy.ts), because the kernel cannot reach the
// databases itself.
export interface AuditSink {
  databaseOf(workspaceId: string): Promise<unknown>;
  ipKey: string;
}

let sink: AuditSink | undefined;

export function bindAudit(next: AuditSink): void {
  sink = next;
}

// A key of `meta` that names a secret is dropped, whatever its value: tokens,
// passwords, link secrets and invitation codes never go into an event
// (plan §3.7, §3.8). The callers do not put them there; this is the net under
// them.
const SECRET_KEY = /code|token|password|secret|credential|authorization/i;

const MAX_META_KEYS = 20;

export function scrub(meta: AuditMeta | undefined): AuditMeta {
  const clean: AuditMeta = {};
  for (const [key, value] of Object.entries(meta ?? {}).slice(
    0,
    MAX_META_KEYS,
  )) {
    if (!SECRET_KEY.test(key)) clean[key] = value;
  }
  return clean;
}

// Records an event in the workspace's audit log, AFTER the write it describes
// has committed. A failure to record is logged and never thrown: an audit
// outage must not undo, or refuse, the work it describes.
async function record(event: AuditEventInput): Promise<void> {
  try {
    if (!sink) throw new Error("the audit log is not bound");
    const mongo = (await sink.databaseOf(event.workspaceId)) as AuditMongo;
    await mongo.db.auditEvents.create({
      at: new Date(),
      actor: {
        type: event.actor.type,
        id: event.actor.id,
        label: event.actor.label ?? null,
      },
      action: event.action,
      target: {
        type: event.target.type,
        id: event.target.id,
        name: event.target.name ?? null,
      },
      ipHash: event.ip ? hashAddress(sink.ipKey, event.ip) : null,
      meta: scrub(event.meta),
    });
  } catch (error) {
    console.error(
      `storix-api: could not record audit event ${event.action} in workspace ${event.workspaceId}:`,
      error,
    );
  }
}

// The port every module calls (`audit.record`), through `@/core/audit`.
export const audit = { record };
