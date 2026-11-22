// The identity surface: the port, its types and the module. Everything else in
// this folder is private; janus is imported only here and in src/config/auth.ts.

export type {
  Account,
  Identity,
  InvitationAction,
  InvitationHooks,
  InvitationResolverMap,
  Locale,
  Principal,
  SecondFactorStatus,
  SignInResult,
  StepUpChallenge,
} from "./identity.port";
export { identityModule } from "./module";
export {
  createJanusIdentity,
  type IdentityOptions,
} from "./services/identity.janus";
export { invitationTypeDefs } from "./services/invitations/invitations.typedefs";
export type { Accepted } from "./services/janus/janus.accounts";
export { API_KEY_PREFIX } from "./services/janus/janus.accounts";
export { requireSession, requireViewer } from "./utils";
