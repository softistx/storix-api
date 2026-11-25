// The shares surface: the module, the effective role and what the guards of
// the other modules ask of it. Everything else in this folder is private.
export { sharesMongo } from "./models";
export { sharesModule, sharesOnRemoved } from "./module";
export type { GrantRole, Role } from "./rules";
export { reaches, strongest } from "./rules";
export {
  dropGrants,
  dropMemberGrants,
  grantsOnNode,
  type RoleNode,
  roleOn,
} from "./services";
export { callerSeat, grantView } from "./utils";
