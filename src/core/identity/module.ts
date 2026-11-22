import { defineModule } from "@softistx/alxia-modules";
import { identity } from "./identity.errors";
import typeDefs from "./identity.graphqls" with { type: "text" };
import { identityResolvers } from "./identity.resolver";

// Accounts: sign-up, sign-in, sign-out, password reset, e-mail verification,
// the second factor and step-up, behind the Identity port. The resolvers read
// the port from the request's context (`identity`, src/http/context.ts).
export const identityModule = defineModule({
  name: "identity",
  codes: identity,
  typeDefs: [typeDefs],
  resolvers: identityResolvers,
});
