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
export { requireSession, requireViewer } from "./identity.resolver";
export { API_KEY_PREFIX } from "./janus.accounts";
export { identityModule } from "./module";
