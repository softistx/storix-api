// The members surface: the roles, the membership check `@alxia/tenancy` asks
// for, and the module. Everything else in this folder is private.

export {
  bindMemberDatabases,
  type MemberJoined,
  memberJoined,
  onMemberJoined,
} from "./members.joined";
export {
  type MemberRemoval,
  onMemberRemoved,
} from "./members.removal";
export {
  activeMemberIds,
  addMember,
  type MemberDoc,
  type MembersMongo,
  membershipOf,
  membershipsOfAccount,
} from "./members.service";
export { membersModule } from "./module";
export { type WorkspaceRole, workspaceRoles } from "./roles";
