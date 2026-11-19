import { defineModule } from "@alxia/modules";
import { auditEvents } from "./audit.collection";
import typeDefs from "./audit.graphqls" with { type: "text" };
import { auditResolvers } from "./audit.resolver";

// The workspace's append-only audit log, in the workspace's own database. Every
// module records through the `Auditor` port (`ctx.audit.record`, audit.record.ts) after its write
// commits. Owns `audit:read`, which OWNER and ADMIN hold: a MEMBER and any API
// key never read the log (plan §3.6, §3.7).
export const auditModule = defineModule({
  name: "audit",
  collections: { auditEvents },
  permissions: ["audit:read"],
  defaultGrants: {
    ADMIN: ["audit:read"],
  },
  typeDefs: [typeDefs],
  resolvers: auditResolvers,
});
