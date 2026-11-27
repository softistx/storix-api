import { defineEnv } from "@softistx/alxia-env";
import { z } from "zod";

const production = Bun.env.NODE_ENV === "production";

// A comma separated list; an empty value is unset.
const trustedProxies = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .transform((list) => (list.length > 0 ? list : undefined));

// "<count>/<seconds>": at most <count> attempts per <seconds> from one client
// address, as the count and the window in milliseconds.
const attempts = (fallback: string) =>
  z
    .string()
    .regex(/^[1-9]\d{0,5}\/[1-9]\d{0,6}$/, 'not "<count>/<seconds>"')
    .default(fallback)
    .transform((value) => {
      const [limit = 0, seconds = 0] = value.split("/").map(Number);
      return { limit, per: seconds * 1000 };
    });

// Required in production; elsewhere `fallback` stands in.
const inProduction = <T extends z.ZodType>(schema: T, fallback: string) =>
  production ? schema : schema.prefault(fallback as z.input<T>);

// Optional outside production, required in it: an empty value is unset.
const orUnset = (schema: z.ZodType<string, string>) =>
  production
    ? schema
    : z
        .string()
        .transform((value) => value || undefined)
        .pipe(schema.optional())
        .optional();

const unsetIfEmpty = z
  .string()
  .transform((value) => value || undefined)
  .optional();

const smtpUrl = z
  .string()
  .regex(/^smtps?:\/\/[^/]/, "not an smtp:// or smtps:// URL");

const mailTransport = z.enum(["bumail", "smtp"]);

const flag = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z
    .enum(["", "0", "false", "no", "off", "1", "true", "yes", "on"])
    .default("")
    .transform((value) => ["1", "true", "yes", "on"].includes(value)),
);

// A development key, refused in production: 32 bytes in base64.
const devTotpKey = "c3RvcmF4LWRldmVsb3BtZW50LXRvdHAta2V5LTMhISE";

// TOTP_KEYS: "id:key,id:key", each key 32 random bytes in base64
// (`openssl rand -base64 32`). The first seals every new TOTP secret, every one
// opens: to rotate, put the new one first and keep the old one. janus checks
// the bytes when it is built; here a malformed list stops the process before it
// listens.
const totpKeys = z
  .string()
  .transform((list) =>
    list
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const at = entry.indexOf(":");
        // No `id:` prefix: an empty id, which the id check below refuses.
        if (at <= 0) return { id: "", key: entry };
        return { id: entry.slice(0, at), key: entry.slice(at + 1) };
      }),
  )
  .pipe(
    z
      .array(
        z.object({
          id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "not a key id"),
          key: z
            .string()
            .regex(/^[A-Za-z0-9+/_-]{43}=?$/, "not 32 bytes in base64"),
        }),
      )
      .min(1, "at least one id:key")
      .refine(
        (keys) => new Set(keys.map((entry) => entry.id)).size === keys.length,
        "two keys have the same id",
      ),
  )
  .transform((keys) => keys as [(typeof keys)[number], ...typeof keys])
  .refine(
    (keys) =>
      !production ||
      keys.every(
        (entry) =>
          !Buffer.from(entry.key, "base64").equals(
            Buffer.from(devTotpKey, "base64"),
          ),
      ),
    "the development key is refused in production",
  );

// Read once, at import: a malformed variable stops the process before it
// listens. `.env.example` lists them; Bun loads `.env` on every command.
export const env = defineEnv({
  // mongodb:// or mongodb+srv://. Transactions need a replica set:
  // docker-compose.yml starts a one-node one. The URI names no database: the
  // core database and each workspace's are named below.
  MONGO_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, "not a MongoDB URI"),
  // The shared database: the workspace registry, janus's collections, the
  // invitations and the translations.
  MONGO_CORE_DATABASE: z
    .string()
    .regex(/^[A-Za-z0-9_]{1,40}$/, "letters, digits and _ only")
    .default("storix_core"),
  // A workspace's database is `<prefix><workspace id>`.
  MONGO_WORKSPACE_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9_]{1,30}$/, "letters, digits and _ only")
    .default("storix_ws_"),
  // How many workspaces' databases stay open (least recently used out).
  MONGO_WORKSPACE_CACHE_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(100),
  // MONGO_AUTO_SYNC: create the validators and indexes of a collection on its
  // first use. Always on outside production; in production only when this is
  // 1, true, yes or on.
  MONGO_AUTO_SYNC: flag,
  // UI_ORIGIN: storix-ui's origin, which every link of a mail starts with.
  // https in production.
  UI_ORIGIN: inProduction(
    z
      .url({ protocol: production ? /^https$/ : /^https?$/ })
      .transform((url) => url.replace(/\/+$/, "")),
    "http://localhost:5173",
  ),
  // MAIL_FROM: the address every mail is sent from.
  MAIL_FROM: inProduction(z.email(), "noreply@storix.test"),
  // MAIL_TRANSPORT: how mail leaves, `bumail` (the Mail API, the default in
  // production) or `smtp` (the fallback kept one release for a rollback).
  // Unset outside production: SMTP when MAIL_URL is set, else the console.
  MAIL_TRANSPORT: production
    ? mailTransport.default("bumail")
    : z
        .string()
        .transform((value) => value || undefined)
        .pipe(mailTransport.optional())
        .optional(),
  // MAIL_URL: the SMTP server of the `smtp` transport (required with it,
  // src/config/mailer.ts). An empty value is unset.
  MAIL_URL: z
    .string()
    .transform((value) => value || undefined)
    .pipe(smtpUrl.optional())
    .optional(),
  // BUMAIL_URL: bumail's GraphQL endpoint, reached on the private network
  // `bumail-internal` only.
  BUMAIL_URL: z
    .string()
    .transform((value) => value || "http://bumail-app:8090/graphql")
    .pipe(z.url({ protocol: /^https?$/ }))
    .default("http://bumail-app:8090/graphql"),
  // BUMAIL_API_KEY_FILE: the file holding the app's `bumail_...` service key
  // (a mounted secret, mode 0600). Required with the `bumail` transport in
  // production; the key itself is never an environment variable.
  BUMAIL_API_KEY_FILE: unsetIfEmpty,
  // TOTP_KEYS: the sealing keys of the accounts' TOTP secrets. Required in
  // production; a development key stands in elsewhere.
  TOTP_KEYS: inProduction(totpKeys, `dev:${devTotpKey}`),
  // RATE_LIMIT_SIGN_UP, RATE_LIMIT_SIGN_IN, RATE_LIMIT_PASSWORD_RESET:
  // "<count>/<seconds>", the attempts one client address may make of signUp,
  // signIn (and the second-factor codes of a sign-in) and requestPasswordReset.
  // Counted in Redis, so they apply only when REDIS_URL is set.
  RATE_LIMIT_SIGN_UP: attempts("10/3600"),
  RATE_LIMIT_SIGN_IN: attempts("30/900"),
  RATE_LIMIT_PASSWORD_RESET: attempts("10/3600"),
  // RATE_LIMIT_WORKSPACE_CREATE: the same, for createWorkspace (each one
  // provisions a database).
  RATE_LIMIT_WORKSPACE_CREATE: attempts("10/3600"),
  // RATE_LIMIT_INVITATION_SEND: the invitations (and resends) one person may
  // send, each a mail; counted per inviter, not per address.
  // RATE_LIMIT_INVITATION_CODE: the previews and accepts of an invitation code
  // one client address may make (they are open to whoever holds a code).
  RATE_LIMIT_INVITATION_SEND: attempts("50/3600"),
  RATE_LIMIT_INVITATION_CODE: attempts("30/900"),
  // AUDIT_IP_KEY: the key the audit log hashes client addresses with (HMAC-
  // SHA256): at least 32 characters. Required in production; a development
  // key stands in elsewhere. Changing it starts a new series of hashes.
  AUDIT_IP_KEY: inProduction(
    z.string().min(32, "at least 32 characters"),
    "storix-development-audit-ip-key-do-not-use",
  ),
  // REDIS_URL: redis:// or rediss://. Rate limits, queues and tokens.
  // Required in production; unset elsewhere.
  REDIS_URL: orUnset(
    z.string().regex(/^rediss?:\/\/[^/]/, "not a redis:// or rediss:// URL"),
  ),
  // TRUSTED_PROXIES: the proxies in front of the API, as addresses or CIDR
  // ranges, comma separated. The client address is read from X-Forwarded-For
  // past these proxies only. Required in production.
  TRUSTED_PROXIES: production
    ? trustedProxies.pipe(
        z.array(z.string(), { error: "required in production" }),
      )
    : trustedProxies.optional(),
  // API_PROXY_SECRET: the secret storix-ui's server sends as
  // `x-storix-proxy-secret` (the same variable on both services). Set, the
  // forwarded client address is honoured only on a request that carries it.
  // Required in production, at least 32 characters.
  API_PROXY_SECRET: production
    ? z.string().min(32, "at least 32 characters")
    : z
        .string()
        .transform((secret) => secret || undefined)
        .pipe(z.string().min(32, "at least 32 characters").optional())
        .optional(),
  // S3_*: the S3-compatible store of the files (SeaweedFS locally). All
  // optional: without S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY the media
  // routes answer 503. An empty value is unset.
  S3_ENDPOINT: z
    .string()
    .transform((value) => value || undefined)
    .pipe(z.url({ protocol: /^https?$/ }).optional())
    .optional(),
  S3_REGION: unsetIfEmpty,
  S3_BUCKET: unsetIfEmpty,
  S3_ACCESS_KEY: unsetIfEmpty,
  S3_SECRET_KEY: unsetIfEmpty,
  // An empty PORT= is unset, not port 0.
  PORT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(1).max(65_535).default(3000),
  ),
});
