import { store } from "@/config/tenancy";
import type { AuditMongo } from "./audit.record";

// What a spec reads of a workspace's audit log, straight from its database,
// oldest first: the stored documents, as the module wrote them.
export async function storedEvents(workspaceId: string) {
  const mongo = (await store.databaseOf(workspaceId)) as unknown as AuditMongo;
  return mongo.db.auditEvents.findMany({
    filter: {},
    sort: { at: 1, _id: 1 },
  });
}

export type Stored = Awaited<ReturnType<typeof storedEvents>>[number];

// The actions of a log, oldest first.
export const actionsOf = (events: readonly Stored[]) =>
  events.map((event) => event.action);
