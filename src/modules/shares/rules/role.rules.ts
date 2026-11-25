// The roles of a node, from the weakest: a grant gives VIEWER or EDITOR, the
// owner of the tree is OWNER (plan §3.6).
export type Role = "OWNER" | "EDITOR" | "VIEWER";
export type GrantRole = "EDITOR" | "VIEWER";

const RANK: Record<Role, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

// The highest of these roles, or null when there is none.
export const strongest = (roles: readonly Role[]): Role | null =>
  roles.reduce<Role | null>(
    (best, role) => (best === null || RANK[role] > RANK[best] ? role : best),
    null,
  );

// Whether a role reaches what `need` allows: VIEWER lists, previews and
// downloads; EDITOR adds upload, rename, move inside, new version, trash and
// sharing; OWNER is the same plus what only the owner does.
export const reaches = (role: Role | null, need: Role): boolean =>
  role !== null && RANK[role] >= RANK[need];

// What the role of a node is computed from: its id, the ids above it and the
// account that owns its tree.
export interface RoleNode {
  _id: { toHexString(): string };
  ancestors: readonly { toHexString(): string }[];
  ownerId: string | null;
}

// A node whose role is asked for the page of a list: `trashed` nodes give
// their owner OWNER and nobody else a role (the grants of a trashed node have
// no effect, as `nodeFor` reads them).
export interface RoleNodeInput extends RoleNode {
  trashed?: boolean;
}
