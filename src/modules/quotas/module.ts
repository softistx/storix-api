import { defineModule } from "@softistx/alxia-modules";
import { quotas as codes } from "@/i18n/codes";
import typeDefs from "./quotas.graphqls" with { type: "text" };
import { quotasResolvers } from "./quotas.resolver";

// The storage of a workspace (plan §3.2): the `storage` query and the recount
// that keeps its counters honest. The counters and the check live with the
// workspace (src/core/workspaces), because the `/media` routes of the kernel
// need them; `addFile` and `copyNodes` raise them in their own transactions.
export const quotasModule = defineModule({
  name: "quotas",
  dependsOn: ["workspaces", "files", "members"],
  codes,
  typeDefs: [typeDefs],
  resolvers: quotasResolvers,
});
