// The members surface: the roles, the membership check `@softistx/alxia-tenancy` asks
// for, and the module. Everything else in this folder is private.

import type { MemberJoinWiring } from "./members.joined";
import type { MemberRemovalWiring } from "./members.removal";

// What the app's wiring hands the members surface (src/config/wiring.ts).
export type MemberWiring = MemberJoinWiring & MemberRemovalWiring;

export { membersMongo } from "./members.handle";
export {
  type JoinListener,
  type MemberJoined,
  type MemberJoinWiring,
  memberJoined,
} from "./members.joined";
export { activeMemberIds, membershipsOfAccount } from "./members.queries";
export {
  type HandoverListener,
  handOver,
  type MemberHandover,
  type MemberRemoval,
  type MemberRemovalWiring,
  type RemovalListener,
} from "./members.removal";
export {
  addMember,
  type MemberDoc,
  type MembersMongo,
  membershipOf,
} from "./members.service";
export { membersModule } from "./module";
export { type WorkspaceRole, workspaceRoles } from "./roles";
