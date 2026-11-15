import { InvalidCursorError } from "@softistx/mongo";
import { fail } from "@/i18n/fail";
import type { AuditMongo } from "./audit.record";

export interface AuditFilter {
  actorId?: string | null | undefined;
  action?: string | null | undefined;
  targetId?: string | null | undefined;
  from?: Date | null | undefined;
  to?: Date | null | undefined;
}

export type AuditDoc = Awaited<
  ReturnType<AuditMongo["db"]["auditEvents"]["getById"]>
>;

// The Mongo filter of the GraphQL one: each given field narrows, `from` and
// `to` bound `at` (from included, to excluded).
function filterOf(filter: AuditFilter | null | undefined) {
  const at: { $gte?: Date; $lt?: Date } = {};
  if (filter?.from) at.$gte = filter.from;
  if (filter?.to) at.$lt = filter.to;
  return {
    ...(filter?.actorId && { "actor.id": filter.actorId }),
    ...(filter?.action && { action: filter.action }),
    ...(filter?.targetId && { "target.id": filter.targetId }),
    ...(Object.keys(at).length > 0 && { at }),
  };
}

// A page of the log, newest first. The cursor is bound to the filter: one
// taken with another filter is `validation.errors.invalid-cursor`.
export async function listEvents(
  mongo: AuditMongo,
  input: {
    filter: AuditFilter | null | undefined;
    first: number;
    after: string | null;
  },
) {
  const filter = filterOf(input.filter);
  try {
    const page = await mongo.db.auditEvents.paginateByCursor({
      filter,
      limit: input.first,
      after: input.after,
      orderBy: "at",
      direction: "desc",
      scope: `audit:${JSON.stringify(filter)}`,
    });
    return { items: page.items, endCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw fail("validation.errors.invalid-cursor", {
        status: 400,
        field: "after",
      });
    }
    throw error;
  }
}
