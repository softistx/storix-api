import type { GrantDoc } from "../models";

// A grant as the API shows it.
export const grantView = (grant: GrantDoc) => ({
  id: grant.id,
  nodeId: grant.nodeId.toHexString(),
  principal: {
    type: grant.principal.type,
    id: grant.principal.id.toHexString(),
  },
  role: grant.role,
  grantedBy: grant.grantedBy,
  createdAt: grant.createdAt,
});
