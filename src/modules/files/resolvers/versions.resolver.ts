import { requireWorkspacePermission } from "@/core/access";
import { callerSeat } from "@/core/members";
import { workspacesMongo } from "@/core/workspaces";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { versionsOf } from "../data-loaders";
import { filesMongo } from "../models";
import {
  addVersion,
  deleteVersion,
  recordRecent,
  restoreVersion,
} from "../services";
import { doneBy, fileOf, recordVersion } from "../utils";
import type { Mutations } from "./support";

// `File.versions`: newest first (needs `nodes:read`), batched per request by
// the versions loader.
export const fileVersionResolvers: NonNullable<Resolvers["File"]> = {
  versions: async (file, _, ctx) => {
    const { rows, currentId } = await versionsOf(file, ctx);
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
        accountId: await callerSeat(scope, principal.accountId),
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
    await ctx.notify.usage({ scope });
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
        accountId: await callerSeat(scope, principal.accountId),
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
    await ctx.notify.usage({ scope });
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
        accountId: await callerSeat(scope, principal.accountId),
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
    await ctx.notify.usage({ scope });
    return fileOf(node);
  },
};
