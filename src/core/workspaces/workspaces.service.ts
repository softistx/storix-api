import type { ModuleCoreHandle } from "@alxia/modules";
import { ConflictError, toObjectId } from "@softistx/mongo";
import type { core } from "@/config/db";
import {
  addMember,
  type MemberDoc,
  type MemberJoinWiring,
  memberJoined,
} from "../members";
import { slugTaken } from "./slug-taken";
import { type Workspace, workspaceOf } from "./workspaces.registry";

// The module's handle on the core database: its own collection and `members`.
export type WorkspacesMongo = ModuleCoreHandle<"workspaces", typeof core>;

// What creating a workspace asks of the tenancy store: build its database,
// then open it to requests.
export interface Provisioner {
  prepare(id: string): Promise<unknown>;
  activate(id: string, actor: string): Promise<unknown>;
}

// Creates a workspace: its row (`provisioning`) and its creator as OWNER in one
// transaction, then its database and its opening to requests. Until then no
// request resolves it, so it never exists without an owner. A failure after
// the transaction takes the rows back out and leaves nothing behind.
export async function createWorkspace(
  mongo: WorkspacesMongo,
  provisioner: Provisioner,
  input: { slug: string; name: string; accountId: string },
  wiring: MemberJoinWiring,
): Promise<Workspace> {
  if (await mongo.db.workspaces.exists({ slug: input.slug })) {
    throw slugTaken();
  }
  let created: Workspace;
  let owner: MemberDoc | undefined;
  try {
    created = await mongo.transaction(async (tx) => {
      const doc = await tx.db.workspaces
        .as(input.accountId)
        .create({ slug: input.slug, name: input.name, status: "provisioning" });
      owner = await addMember(tx, {
        workspaceId: doc.id,
        accountId: input.accountId,
        role: "OWNER",
        actorId: input.accountId,
      });
      return workspaceOf(doc);
    });
  } catch (error) {
    if (error instanceof ConflictError) throw slugTaken();
    throw error;
  }
  try {
    await provisioner.prepare(created.id);
    await provisioner.activate(created.id, input.accountId);
  } catch (error) {
    await takeBack(mongo, created.id);
    throw error;
  }
  if (owner) await memberJoined(wiring, owner);
  return workspaceOf(await mongo.db.workspaces.getById(created.id));
}

// The name of an open workspace, for the pages that say which one an invitee
// joins; null for an unknown id or a workspace not open yet.
export async function activeWorkspaceName(
  mongo: WorkspacesMongo,
  id: string,
): Promise<string | null> {
  const doc = await mongo.db.workspaces.findById(id);
  return doc?.status === "active" ? doc.name : null;
}

// Removes what a failed creation left, best effort: the database it may have
// built stays (empty) and is dropped with the workspaces' cleanup script.
async function takeBack(mongo: WorkspacesMongo, id: string) {
  try {
    await mongo.transaction(async (tx) => {
      await tx.db.members.deleteMany({ workspaceId: toObjectId(id) });
      await tx.db.workspaces.hardDelete(id);
    });
  } catch (error) {
    console.error(`storix-api: could not take back workspace ${id}:`, error);
  }
}
