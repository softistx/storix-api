// The workspace roles, highest first (plan §3.6): OWNER (everything, deletes the
// workspace), ADMIN (members, teams, settings, API keys, audit, storage) and
// MEMBER (own files and what is shared with them). The names are stored as
// they are; `src/config/access.ts` builds the permission matrix over them.
export const workspaceRoles = ["OWNER", "ADMIN", "MEMBER"] as const;

export type WorkspaceRole = (typeof workspaceRoles)[number];
