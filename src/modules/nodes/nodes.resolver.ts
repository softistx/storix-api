import { requireWorkspacePermission } from "@/core/access";
import { memberActor } from "@/core/audit";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { invalidInput } from "@/i18n/fail";
import { recordFolderCreate, recordMove, recordRename } from "./nodes.audit";
import { nodesMongo } from "./nodes.handle";
import { listNodes } from "./nodes.list";
import { moveNodes } from "./nodes.move";
import { ownerOf } from "./nodes.owner";
import { checkName } from "./nodes.rules";
import { createFolder, ownedNode, renameNode } from "./nodes.service";
import { foldersOf, nodeView, pathTo, rootsOf } from "./nodes.tree";

// The module's handle on the request's workspace database.
const workspaceDb = (scope: { readonly mongo: unknown }) =>
  nodesMongo(scope.mongo);

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
  Folder: { owner: (node, _, ctx) => ownerOf(node, ctx) },
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
    node: async (_, { id }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      return nodeView(
        await ownedNode(workspaceDb(scope), id, principal.accountId),
      );
    },
    nodes: async (_, { parentId, filter, sort, first, after }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const page = await listNodes(workspaceDb(scope), {
        parentId,
        accountId: principal.accountId,
        filter,
        sort,
        first,
        after,
      });
      return {
        nodes: page.items.map(nodeView),
        pageInfo: {
          startCursor: null,
          endCursor: page.endCursor,
          hasNextPage: page.endCursor !== null,
          hasPreviousPage: after != null,
        },
      };
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
