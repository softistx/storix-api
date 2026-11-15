import { requireWorkspacePermission } from "@/core/access";
import { memberActor } from "@/core/audit";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { invalidInput } from "@/i18n/fail";
import { recordFolderCreate, recordMove, recordRename } from "./nodes.audit";
import { moveNodes } from "./nodes.move";
import { checkName } from "./nodes.rules";
import { createFolder, type NodesMongo, renameNode } from "./nodes.service";
import { foldersOf, nodeView, pathTo, rootsOf } from "./nodes.tree";

// The module's handle on the request's workspace database (the scope's, typed
// by the registry; see src/core/access/ports.ts).
const workspaceDb = (scope: { readonly mongo: unknown }) =>
  scope.mongo as NodesMongo;

// A name is trimmed and checked; a refused one is a field issue of `name`.
function nameOf(raw: string): string {
  const checked = checkName(raw);
  if ("issue" in checked) {
    throw invalidInput([
      {
        path: "name",
        code: checked.issue,
        ...(checked.issue === "validation.errors.too-short" && {
          params: { min: 1 },
        }),
      },
    ]);
  }
  return checked.name;
}

export const nodesResolvers: Resolvers = {
  Query: {
    roots: async (_, __, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const roots = await rootsOf(workspaceDb(scope), principal.accountId);
      return roots.map(nodeView);
    },
    folders: async (_, { parentId }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const folders = await foldersOf(
        workspaceDb(scope),
        parentId,
        principal.accountId,
      );
      return folders.map(nodeView);
    },
    nodePath: async (_, { id }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const path = await pathTo(workspaceDb(scope), id, principal.accountId);
      return path.map(nodeView);
    },
  },
  Mutation: {
    createFolder: async (_, { parentId, name }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const node = await createFolder(workspaceDb(scope), {
        parentId,
        name: nameOf(name),
        accountId: principal.accountId,
      });
      await recordFolderCreate(
        {
          workspaceId: scope.tenant.id,
          actor: memberActor(principal),
          ip: ctx.ip,
        },
        node,
      );
      return nodeView(node);
    },
    renameNode: async (_, { id, name, version }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const { node, before } = await renameNode(workspaceDb(scope), {
        id,
        name: nameOf(name),
        version,
        accountId: principal.accountId,
      });
      await recordRename(
        {
          workspaceId: scope.tenant.id,
          actor: memberActor(principal),
          ip: ctx.ip,
        },
        node,
        before,
      );
      return nodeView(node);
    },
    moveNodes: async (_, { ids, parentId }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const moved = await moveNodes(workspaceDb(scope), {
        ids,
        parentId,
        accountId: principal.accountId,
      });
      const done = {
        workspaceId: scope.tenant.id,
        actor: memberActor(principal),
        ip: ctx.ip,
      };
      for (const { node, from } of moved) {
        if (from !== node.parentId?.toHexString()) {
          await recordMove(done, node, from);
        }
      }
      return moved.map(({ node }) => nodeView(node));
    },
  },
};
