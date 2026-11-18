import { requireWorkspacePermission } from "@/core/access";
import { type Auditor, memberActor } from "@/core/audit";
import { workspacesMongo } from "@/core/workspaces";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { nodeView } from "@/modules/nodes/public";
import { recordVersion } from "./files.audit";
import { notAFile } from "./files.errors";
import { filesMongo } from "./files.handle";
import { recordRecent } from "./files.recents";
import {
  addVersion,
  deleteVersion,
  listVersions,
  restoreVersion,
} from "./files.versions";

type Mutations = NonNullable<Resolvers["Mutation"]>;

const fileOf = (node: Parameters<typeof nodeView>[0]) => {
  const view = nodeView(node);
  if (view.__typename !== "File") throw notAFile();
  return view;
};

const doneBy = (
  ctx: { ip?: string | null | undefined; audit: Auditor },
  workspaceId: string,
  principal: { accountId: string; name: string },
) => ({
  workspaceId,
  actor: memberActor(principal),
  ip: ctx.ip,
  auditor: ctx.audit,
});

// `File.versions`: newest first (needs `nodes:read`).
export const fileVersionResolvers: NonNullable<Resolvers["File"]> = {
  versions: async (file, _, ctx) => {
    const { principal, scope } = await requireWorkspacePermission(
      ctx,
      "nodes:read",
    );
    const { rows, currentId } = await listVersions(filesMongo(scope.mongo), {
      id: file.id,
      accountId: principal.accountId,
    });
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      key: row.blobKey,
      mimeType: row.mimeType,
      size: row.size,
      createdBy: row.createdBy,
      note: row.note,
      restoredFrom: row.restoredFrom,
      current: row.id === currentId,
      createdAt: row.createdAt,
    }));
  },
};

// The three writes (need `nodes:manage`), audited as `file.version-*`.
export const versionMutations: Pick<
  Mutations,
  "addFileVersion" | "restoreFileVersion" | "deleteFileVersion"
> = {
  addFileVersion: async (_, { fileId, key, note }, ctx) => {
    const { principal, scope } = await requireWorkspacePermission(
      ctx,
      "nodes:manage",
    );
    const mongo = filesMongo(scope.mongo);
    const { node, number } = await addVersion(
      mongo,
      workspacesMongo(ctx.tenancy.core),
      ctx.media,
      ctx.renditions,
      {
        workspaceId: scope.tenant.id,
        accountId: principal.accountId,
        id: fileId,
        key,
        note: note?.trim() || null,
      },
    );
    await recordVersion(
      doneBy(ctx, scope.tenant.id, principal),
      "file.version-add",
      node,
      { number },
    );
    await recordRecent(mongo, {
      accountId: principal.accountId,
      nodeId: node._id,
    }).catch(() => undefined);
    return fileOf(node);
  },
  restoreFileVersion: async (_, { fileId, versionId, note }, ctx) => {
    const { principal, scope } = await requireWorkspacePermission(
      ctx,
      "nodes:manage",
    );
    const { node, from, number } = await restoreVersion(
      filesMongo(scope.mongo),
      workspacesMongo(ctx.tenancy.core),
      ctx.renditions,
      {
        workspaceId: scope.tenant.id,
        accountId: principal.accountId,
        id: fileId,
        versionId,
        note: note?.trim() || null,
      },
    );
    await recordVersion(
      doneBy(ctx, scope.tenant.id, principal),
      "file.version-restore",
      node,
      { number, from },
    );
    return fileOf(node);
  },
  deleteFileVersion: async (_, { fileId, versionId }, ctx) => {
    const { principal, scope } = await requireWorkspacePermission(
      ctx,
      "nodes:manage",
    );
    const { node, number } = await deleteVersion(
      filesMongo(scope.mongo),
      workspacesMongo(ctx.tenancy.core),
      {
        workspaceId: scope.tenant.id,
        accountId: principal.accountId,
        id: fileId,
        versionId,
      },
    );
    await recordVersion(
      doneBy(ctx, scope.tenant.id, principal),
      "file.version-delete",
      node,
      { number },
    );
    return fileOf(node);
  },
};
