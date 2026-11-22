import { InvalidCursorError } from "@softistx/mongo";
import { fail } from "@/i18n/fail";
import { filterOf } from "../utils/filter.utils";
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
