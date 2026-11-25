import DataLoader from "dataloader";
import { requireWorkspacePermission } from "@/core/access";
import type { Context } from "@/http/context";
import { callerSeat } from "@/modules/shares/public";
import { filesMongo } from "../models";
import { listVersionsBatch, type VersionsOfFile } from "../services";

// One loader per request: every file of a page asks for its versions, and the
// request's `nodes:read` guard and the two reads (the files, their versions)
// run once for the distinct files. A file the caller cannot read is its own
// error (`nodes.errors.not-found`); a refused guard fails every file the same
// way. Nothing is cached across loads (`cache: false`): a mutation of the
// request may change a file's versions before a later field reads them.
const loaders = new WeakMap<object, DataLoader<string, VersionsOfFile>>();

// `File.versions`: the file's versions, newest first, and the current one's id.
export function versionsOf(
  file: { id: string },
  ctx: Context,
): Promise<VersionsOfFile> {
  let loader = loaders.get(ctx);
  if (!loader) {
    loader = new DataLoader<string, VersionsOfFile>(
      async (ids) => {
        try {
          const { principal, scope } = await requireWorkspacePermission(
            ctx,
            "nodes:read",
          );
          return await listVersionsBatch(filesMongo(scope.mongo), {
            ids,
            accountId: await callerSeat(scope, principal.accountId),
          });
        } catch (error) {
          return ids.map(() => error as Error);
        }
      },
      { cache: false },
    );
    loaders.set(ctx, loader);
  }
  return loader.load(file.id);
}
