import { createJanusIdentity } from "../core/identity/identity.janus";
import { joinWorkspace } from "../core/invitations";
import type { MembersMongo } from "../core/members";
import { core } from "./db";
import { env } from "./env";
import { serverMailer } from "./mailer";
import { members } from "./wiring";

// The identity the server runs: janus over the core database, its mails
// through MAIL_URL, and an accepted invitation adding its account to the
// workspace. With `src/core/identity`, the only place that imports janus
// (`bun run deps:check`).
export const identity = createJanusIdentity({
  db: core.db,
  mailer: serverMailer(env.MAIL_URL),
  uiOrigin: env.UI_ORIGIN,
  mailFrom: env.MAIL_FROM,
  totpKeys: env.TOTP_KEYS,
  onAcceptedInvitation: (accepted) =>
    joinWorkspace(core as unknown as MembersMongo, accepted, members),
});
