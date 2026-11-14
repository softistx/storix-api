// The identity surface: the port, its types and the module. Everything else in
// this folder is private; janus is imported only here and in src/config/auth.ts.

export { createJanusIdentity, type IdentityOptions } from "./identity.janus";
export type {
  Account,
  Identity,
  Locale,
  Principal,
  SecondFactorStatus,
  SignInResult,
  StepUpChallenge,
} from "./identity.port";
export { requireViewer } from "./identity.resolver";
export { identityModule } from "./module";
