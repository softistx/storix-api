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
