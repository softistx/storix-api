import { authValidationErrors } from "./2026-11-13-auth-validation-errors.migration";
import { identityErrors } from "./2026-11-14-identity-errors.migration";
import { workspacesErrors } from "./2026-11-14-workspaces-errors.migration";
import { invitationsErrors } from "./2026-11-15-invitations-errors.migration";
import { teamsErrors } from "./2026-11-15-teams-errors.migration";
import { nodesErrors } from "./2026-11-16-nodes-errors.migration";
import { storageErrors } from "./2026-11-16-storage-errors.migration";

// The core database's migrations, in order. The list only grows at its end; an
// id is permanent. `db:migrate` applies them (src/scripts/db-migrate.ts).
export const translationMigrations = [
  authValidationErrors,
  identityErrors,
  workspacesErrors,
  invitationsErrors,
  teamsErrors,
  nodesErrors,
  storageErrors,
];
