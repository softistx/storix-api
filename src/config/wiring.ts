import { createAuditor } from "../core/audit";
import type { MemberWiring } from "../core/members";
import { nodesOnHandover, nodesOnJoin } from "../modules/nodes/public";
import { teamsOnRemoved } from "../modules/teams/public";
import { env } from "./env";
import { store } from "./tenancy";

// What the app hands down to the kernel, which cannot reach the workspaces'
// databases nor import the business modules (the layers of
// test/boundaries.spec.ts). Plain values, built once here and carried by the
// request context (`createApp`), and by the identity
// (`src/config/auth.ts`): no module of the kernel keeps a registry of its own.

// Who is told when a member joins (their root folder is made) or leaves (their
// teams drop them, their files go to a receiver), and where a workspace's
// database is found.
export const members: MemberWiring = {
  databaseOf: (workspaceId) => store.databaseOf(workspaceId),
  onJoined: [nodesOnJoin],
  onRemoved: [teamsOnRemoved],
  onHandover: [nodesOnHandover],
};

// The audit log: events go to the workspace's own database, and addresses are
// hashed under AUDIT_IP_KEY.
export const auditor = createAuditor({
  databaseOf: (workspaceId) => store.databaseOf(workspaceId),
  ipKey: env.AUDIT_IP_KEY,
});
