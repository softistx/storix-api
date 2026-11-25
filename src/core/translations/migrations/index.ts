import { authValidationErrors } from "./2026-11-13-auth-validation-errors.migration";
import { identityErrors } from "./2026-11-14-identity-errors.migration";
import { workspacesErrors } from "./2026-11-14-workspaces-errors.migration";
import { invitationsErrors } from "./2026-11-15-invitations-errors.migration";
import { teamsErrors } from "./2026-11-15-teams-errors.migration";
import { nodesErrors } from "./2026-11-16-nodes-errors.migration";
import { storageErrors } from "./2026-11-16-storage-errors.migration";
import { filesErrors } from "./2026-11-17-files-errors.migration";
import { filesCopyErrors } from "./2026-11-18-files-copy-errors.migration";
import { quotasErrors } from "./2026-11-19-quotas-errors.migration";
import { filesFocalErrors } from "./2026-11-20-files-focal-errors.migration";
import { versionsErrors } from "./2026-11-21-versions-errors.migration";
import { trashErrors } from "./2026-11-21-versions-trash-errors.migration";
import { invitationsStatesErrors } from "./2026-11-22-invitations-states-errors.migration";
import { accountSecurityErrors } from "./2026-11-23-account-security-errors.migration";
import { sharesErrors } from "./2026-11-24-shares-errors.migration";
import { notificationsErrors } from "./2026-11-25-notifications-errors.migration";
import { notificationsMail } from "./2026-11-25-notifications-mail.migration";

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
  filesErrors,
  filesCopyErrors,
  quotasErrors,
  filesFocalErrors,
  versionsErrors,
  trashErrors,
  invitationsStatesErrors,
  accountSecurityErrors,
  sharesErrors,
  notificationsErrors,
  notificationsMail,
];
