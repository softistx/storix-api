// The members surface: the roles, the membership check `@alxia/tenancy` asks
// for, and the module. Everything else in this folder is private.

export {
  bindMemberDatabases,
  type MemberJoined,
  memberJoined,
  onMemberJoined,
} from "./members.joined";
export { activeMemberIds, membershipsOfAccount } from "./members.queries";
export {
  handOver,
  type MemberHandover,
  type MemberRemoval,
  onMemberHandover,
  onMemberRemoved,
} from "./members.removal";
export {
  addMember,
  type MemberDoc,
  type MembersMongo,
  membershipOf,
} from "./members.service";
export { membersModule } from "./module";
export { type WorkspaceRole, workspaceRoles } from "./roles";
