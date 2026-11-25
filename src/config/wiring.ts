import { createAuditor } from "../core/audit";
import type { MemberWiring } from "../core/members";
import { nodesOnHandover, nodesOnJoin } from "../modules/nodes/public";
import { notificationsOnRemoved } from "../modules/notifications/public";
import {
  sharesOnJoined,
  sharesOnRemoved,
  sharesOnTeamDeleted,
} from "../modules/shares/public";
import type { TeamsWiring } from "../modules/teams/public";
import { teamsOnRemoved } from "../modules/teams/public";
import { env } from "./env";
import { store } from "./tenancy";

// What the app hands down to the kernel, which cannot reach the workspaces'
// databases nor import the business modules (the layers of
// test/boundaries.spec.ts). Plain values, built once here and carried by the
// request context (`createApp`), and by the identity
// (`src/config/auth.ts`): no module of the kernel keeps a registry of its own.

// Who is told when a member joins (their root folder is made, the grants that
// still name their row end) or leaves (their grants end before the removal
// commits, their teams drop them, their files go to a receiver), and where a
// workspace's database is found.
export const members: MemberWiring = {
  databaseOf: (workspaceId) => store.databaseOf(workspaceId),
  onJoined: [nodesOnJoin, sharesOnJoined],
  onRemoving: [sharesOnRemoved],
  onRemoved: [teamsOnRemoved, notificationsOnRemoved],
  onHandover: [nodesOnHandover],
};

// Who is told when a team is deleted: the grants made to it end.
export const teams: TeamsWiring = { onDeleted: [sharesOnTeamDeleted] };

// The audit log: events go to the workspace's own database, and addresses are
// hashed under AUDIT_IP_KEY.
export const auditor = createAuditor({
  databaseOf: (workspaceId) => store.databaseOf(workspaceId),
  ipKey: env.AUDIT_IP_KEY,
});
