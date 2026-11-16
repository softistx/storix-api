import { createHash } from "node:crypto";
import type { createMongoInvitations } from "@softistx/janus-mongo";
import type { InvitationState } from "./identity.port";
import { authCall } from "./janus.errors";

// Temporary, until nxgt-janus#855: janus-graphql should state the reason.
// What an invitation code names, for the one answer janus withholds: janus
// refuses every unusable code as `INVITATION_INVALID` and tells nothing apart.
// The code is the invitee's own secret (43 characters, mailed to them), so
// saying why it fails tells nobody anything they do not already hold.
type Store = ReturnType<typeof createMongoInvitations>;

// janus keeps the sha256 (hex) of the code, never the code.
const hashOf = (code: string) =>
  createHash("sha256").update(code).digest("hex");

export function invitationStateReader(
  store: Pick<Store, "findInvitationByCodeHash">,
  now: () => Date,
) {
  return (code: string): Promise<InvitationState> =>
    authCall(async () => {
      const found = await store.findInvitationByCodeHash(hashOf(code));
      if (!found) return "unknown";
      if (found.status === "accepted") return "accepted";
      if (found.status === "revoked") return "revoked";
      return found.expiresAt.getTime() <= now().getTime()
        ? "expired"
        : "pending";
    });
}
