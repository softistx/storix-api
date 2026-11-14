import { createJanusIdentity } from "../core/identity/identity.janus";
import { core } from "./db";
import { env } from "./env";
import { serverMailer } from "./mailer";

// The identity the server runs: janus over the core database, its mails
// through MAIL_URL. With `src/core/identity`, the only place that imports
// janus (`bun run deps:check`).
export const identity = createJanusIdentity({
  db: core.db,
  mailer: serverMailer(env.MAIL_URL),
  uiOrigin: env.UI_ORIGIN,
  mailFrom: env.MAIL_FROM,
  totpKeys: env.TOTP_KEYS,
});
