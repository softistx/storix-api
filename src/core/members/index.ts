// The members surface: the roles, the membership check `@alxia/tenancy` asks
// for, and the module. Everything else in this folder is private.

export {
  type MemberRemoval,
  onMemberRemoved,
} from "./members.removal";
export {
  activeMemberIds,
  addMember,
  type MembersMongo,
  membershipOf,
  membershipsOfAccount,
} from "./members.service";
export { membersModule } from "./module";
export { type WorkspaceRole, workspaceRoles } from "./roles";
