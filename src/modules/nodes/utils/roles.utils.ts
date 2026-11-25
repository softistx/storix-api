import type { RoleNodeInput } from "@/modules/shares/public";

// What the role of a node is computed from, taken from the node as the API
// says it (string ids), for the field resolvers that only hold the view.
export const roleNodeOf = (view: {
  id: string;
  ancestors: readonly string[];
  ownerId: string | null;
  trashedAt?: Date | null;
}): RoleNodeInput => ({
  _id: { toHexString: () => view.id },
  ancestors: view.ancestors.map((id) => ({ toHexString: () => id })),
  ownerId: view.ownerId,
  trashed: Boolean(view.trashedAt),
});
