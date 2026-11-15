import { defineCollection, id } from "@softistx/mongo";
import { z } from "zod";

// How a workspace is told apart from an id in the tenant header: a slug is a
// lower-case word, never 24 hexadecimal digits (an ObjectId).
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const isObjectIdLike = (value: string) => /^[0-9a-f]{24}$/.test(value);

// The workspaces, in the core database: the registry of tenants. Each one has
// a database of its own (`MONGO_WORKSPACE_PREFIX` + its id), opened by
// `@alxia/tenancy`. `status` is the tenancy lifecycle: only an `active`
// workspace answers a request. Quota, usage and settings join with the slices
// that use them (A11 and later). Actors are account ids.
export const workspaces = defineCollection({
  name: "workspaces",
  schema: z.object({
    _id: id(),
    slug: z.string().regex(SLUG_PATTERN),
    name: z.string().min(1).max(100),
    status: z.enum(["provisioning", "active", "archived"]),
  }),
  timestamps: true,
  optimisticLock: true,
  actors: { type: z.string() },
  indexes: [{ key: { slug: 1 }, unique: true, name: "workspaces_slug_unique" }],
});
