import DataLoader from "dataloader";
import type { Context } from "@/http/context";
import { workspacesMongo } from "../models";
import { type Settings, settingsOfMany } from "../services";
import { notFound } from "../workspaces.errors";

// One loader per request: a list of workspaces (`myWorkspaces`) reads every
// workspace's settings in one query. A workspace that is gone is
// `workspaces.errors.not-found` for that field alone. Nothing is cached across
// loads (`cache: false`): `updateWorkspaceSettings` may run before a later
// field reads the settings.
const loaders = new WeakMap<object, DataLoader<string, Settings>>();

// `Workspace.settings`.
export function settingsOfWorkspace(
  workspace: { id: string },
  ctx: Context,
): Promise<Settings> {
  let loader = loaders.get(ctx);
  if (!loader) {
    loader = new DataLoader<string, Settings>(
      async (ids) => {
        const found = await settingsOfMany(
          workspacesMongo(ctx.tenancy.core),
          ids,
        );
        return ids.map((id) => found.get(id) ?? notFound());
      },
      { cache: false },
    );
    loaders.set(ctx, loader);
  }
  return loader.load(workspace.id);
}
