import { toObjectId } from "@softistx/mongo";
import { fail } from "@/i18n/fail";
import { DEFAULT_QUOTA_BYTES } from "./workspaces.collection";
import type { WorkspacesMongo } from "./workspaces.service";

// A workspace's storage: its quota and what it holds (plan §3.9). `bytes`
// counts each distinct blob once, so a copy that shares a blob adds nothing;
// `files` counts live file nodes, copies included (a trashed file is not one);
// `versionBytes` the blobs only versions hold (no node does), `trashBytes` the
// blobs only trashed nodes hold (see `files.accounting.ts`). The counters are raised and
// lowered in the transaction that changes a ref (`addUsage`), and `reconcile`
// (src/modules/quotas) recounts them.
export interface Usage {
  bytes: number;
  files: number;
  versionBytes: number;
  trashBytes: number;
}

export interface Storage {
  quotaBytes: number;
  usage: Usage;
}

const inSession = (session: WorkspacesMongo["session"]) =>
  session ? { session } : {};

const EMPTY_USAGE: Usage = {
  bytes: 0,
  files: 0,
  versionBytes: 0,
  trashBytes: 0,
};

export const quotaExceeded = () =>
  fail("quotas.errors.exceeded", { status: 413 });

// The quota and the counters of a workspace, `undefined` for an unknown one.
export async function storageOf(
  mongo: WorkspacesMongo,
  workspaceId: string,
): Promise<Storage | undefined> {
  const doc = await mongo.db.workspaces.findById(workspaceId);
  // A workspace stored before the quota existed has neither field until the
  // migration ran: read the defaults.
  return (
    doc && {
      quotaBytes: doc.quotaBytes ?? DEFAULT_QUOTA_BYTES,
      usage: { ...EMPTY_USAGE, ...doc.usage },
    }
  );
}

// Whether `bytes` more fit under the quota. A first look, not a reservation:
// `/media` asks it before the body is read, `addFile` decides in its
// transaction.
export async function hasRoom(
  mongo: WorkspacesMongo,
  workspaceId: string,
  bytes: number,
): Promise<boolean> {
  const storage = await storageOf(mongo, workspaceId);
  return (
    storage !== undefined && storage.usage.bytes + bytes <= storage.quotaBytes
  );
}

// Moves the counters by a delta, atomically and without touching the row's
// `version` (a quota change never fails a concurrent rename of the workspace).
// A delta that raises `bytes` is refused with `quotas.errors.exceeded` when it
// would pass the quota; lowering is never refused. Give it the `mongo` of the
// transaction that changes the ref (`core.withSession(tx.session)`), so the
// counters and the ref commit together.
export async function addUsage(
  mongo: WorkspacesMongo,
  workspaceId: string,
  delta: {
    bytes: number;
    files: number;
    versionBytes?: number;
    trashBytes?: number;
  },
): Promise<void> {
  const collection = mongo.db.workspaces;
  const _id = toObjectId(workspaceId);
  const fits = {
    $expr: {
      $lte: [
        { $add: [{ $ifNull: ["$usage.bytes", 0] }, delta.bytes] },
        { $ifNull: ["$quotaBytes", DEFAULT_QUOTA_BYTES] },
      ],
    },
  };
  const result = await collection.raw.updateOne(
    delta.bytes > 0 ? { _id, ...fits } : { _id },
    {
      $inc: {
        "usage.bytes": delta.bytes,
        "usage.files": delta.files,
        ...(delta.versionBytes && { "usage.versionBytes": delta.versionBytes }),
        ...(delta.trashBytes && { "usage.trashBytes": delta.trashBytes }),
      },
    },
    inSession(collection.session),
  );
  if (result.matchedCount === 0) throw quotaExceeded();
}

// Sets the counters to a recount (the reconcile job's write).
export async function setUsage(
  mongo: WorkspacesMongo,
  workspaceId: string,
  usage: Pick<Usage, "bytes" | "files"> & {
    versionBytes?: number;
    trashBytes?: number;
  },
): Promise<void> {
  const collection = mongo.db.workspaces;
  await collection.raw.updateOne(
    { _id: toObjectId(workspaceId) },
    {
      $set: {
        "usage.bytes": usage.bytes,
        "usage.files": usage.files,
        ...(usage.versionBytes !== undefined && {
          "usage.versionBytes": usage.versionBytes,
        }),
        ...(usage.trashBytes !== undefined && {
          "usage.trashBytes": usage.trashBytes,
        }),
      },
    },
    inSession(collection.session),
  );
}

// Sets a workspace's quota by its slug (the platform script's write). `false`
// for an unknown slug.
export async function setQuota(
  mongo: WorkspacesMongo,
  slug: string,
  quotaBytes: number,
): Promise<boolean> {
  const collection = mongo.db.workspaces;
  const result = await collection.raw.updateOne(
    { slug },
    { $set: { quotaBytes } },
  );
  return result.matchedCount > 0;
}
