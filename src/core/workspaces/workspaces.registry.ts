import type { ModuleCoreHandle } from "@alxia/modules";
import type { Tenant, TenantRegistry } from "@alxia/tenancy";
import { ConflictError } from "@softistx/mongo";
import type { core } from "@/config/db";
import { slugTaken } from "./slug-taken";

type WorkspacesMongo = ModuleCoreHandle<"workspaces", typeof core>;

// A workspace as `@alxia/tenancy` reads it: the tenant, with its lock.
export interface Workspace extends Tenant {
  version: number;
  createdAt: Date;
}

type Doc = Awaited<ReturnType<WorkspacesMongo["db"]["workspaces"]["getById"]>>;

export const workspaceOf = (doc: Doc): Workspace => ({
  id: doc.id,
  slug: doc.slug,
  name: doc.name,
  status: doc.status,
  version: doc.version,
  createdAt: doc.createdAt,
});

// The port `@alxia/tenancy` resolves a request's workspace through, over the
// `workspaces` collection of the core database.
export const workspaceRegistry = (
  mongo: WorkspacesMongo,
): TenantRegistry<Workspace> => ({
  async findById(id) {
    const doc = await mongo.db.workspaces.findById(id);
    return doc ? workspaceOf(doc) : undefined;
  },
  async findBySlug(slug) {
    const doc = await mongo.db.workspaces.findFirst({ slug });
    return doc ? workspaceOf(doc) : undefined;
  },
  async list() {
    return (await mongo.db.workspaces.findMany({})).map(workspaceOf);
  },
  async create(input, actor) {
    try {
      return workspaceOf(
        await mongo.db.workspaces
          .as(actor)
          .create({ ...input, status: "provisioning" }),
      );
    } catch (error) {
      if (error instanceof ConflictError) throw slugTaken();
      throw error;
    }
  },
  async activate(tenant, actor) {
    return workspaceOf(
      await mongo.db.workspaces
        .as(actor)
        .update(tenant.id, { status: "active", version: tenant.version }),
    );
  },
});
