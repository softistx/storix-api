import type { AuditFilter } from "../services/audit.service";

// The Mongo filter of the GraphQL one: each given field narrows, `from` and
// `to` bound `at` (from included, to excluded).
export function filterOf(filter: AuditFilter | null | undefined) {
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
