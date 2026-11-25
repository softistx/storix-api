// The members surface: the roles, the membership check `@softistx/alxia-tenancy` asks
// for, and the module. Everything else in this folder is private.

import type { MemberJoinWiring, MemberRemovalWiring } from "./services";

// What the app's wiring hands the members surface (src/config/wiring.ts).
export type MemberWiring = MemberJoinWiring & MemberRemovalWiring;

export { membersMongo } from "./models";
export { membersModule } from "./module";
export { type WorkspaceRole, workspaceRoles } from "./roles";
export {
  accountOf,
  activeMemberIds,
  activeMemberOf,
  addMember,
  callerSeat,
  type HandoverListener,
  handOver,
  type JoinListener,
  type MemberDoc,
  type MemberHandover,
  type MemberJoined,
  type MemberJoinWiring,
  type MemberRemoval,
  type MemberRemovalWiring,
  type MembersMongo,
  memberJoined,
  memberOf,
  membershipOf,
  membershipsOfAccount,
  type RemovalListener,
  type Seat,
  seatOf,
  type Who,
} from "./services";
