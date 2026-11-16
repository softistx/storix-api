import { defineCollection, id } from "@softistx/mongo";
import { z } from "zod";

// How a workspace is told apart from an id in the tenant header: a slug is a
// lower-case word, never 24 hexadecimal digits (an ObjectId).
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const isObjectIdLike = (value: string) => /^[0-9a-f]{24}$/.test(value);

// The workspaces, in the core database: the registry of tenants. Each one has
// a database of its own (`MONGO_WORKSPACE_PREFIX` + its id), opened by
// `@alxia/tenancy`. `status` is the tenancy lifecycle: only an `active`
// workspace answers a request. `quotaBytes` is the storage the workspace may
// hold (default 10 GiB, set by `bun run workspace:quota`) and `usage` its
// counters, kept by `workspaces.usage.ts` (plan §3.9); `settings` are below.
// Actors are account ids.
export const GIB = 1024 ** 3;
export const DEFAULT_QUOTA_BYTES = 10 * GIB;

// What a workspace holds, in bytes of distinct blobs (a shared blob once;
// versions and trash count, Q9) and in file nodes. `versionBytes` and
// `trashBytes` are the parts of `bytes` that only versions and the trash hold.
export const usageSchema = z.object({
  bytes: z.number().int().nonnegative().default(0),
  files: z.number().int().nonnegative().default(0),
  versionBytes: z.number().int().nonnegative().default(0),
  trashBytes: z.number().int().nonnegative().default(0),
});

// What an administrator tunes (plan §3.3): how long the trash keeps what it
// holds (`trashDays`) and how many versions a file keeps (`versionsMax`) and
// for how long (`versionsDays`). The retention job (`bun run retention`)
// applies them; the link and AI settings join with the slices that use them.
export const DEFAULT_SETTINGS = {
  trashDays: 30,
  versionsMax: 20,
  versionsDays: 90,
} as const;

export const settingsSchema = z.object({
  trashDays: z.number().int().min(1).max(3650).default(30),
  versionsMax: z.number().int().min(1).max(1000).default(20),
  versionsDays: z.number().int().min(1).max(3650).default(90),
});

export const workspaces = defineCollection({
  name: "workspaces",
  schema: z.object({
    _id: id(),
    slug: z.string().regex(SLUG_PATTERN),
    name: z.string().min(1).max(100),
    status: z.enum(["provisioning", "active", "archived"]),
    quotaBytes: z.number().int().positive().default(DEFAULT_QUOTA_BYTES),
    usage: usageSchema.default({
      bytes: 0,
      files: 0,
      versionBytes: 0,
      trashBytes: 0,
    }),
    settings: settingsSchema.default({ ...DEFAULT_SETTINGS }),
  }),
  timestamps: true,
  optimisticLock: true,
  actors: { type: z.string() },
  indexes: [{ key: { slug: 1 }, unique: true, name: "workspaces_slug_unique" }],
});
