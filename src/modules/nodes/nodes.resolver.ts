import { requireWorkspacePermission } from "@/core/access";
import { memberActor } from "@/core/audit";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { ownerOf } from "./data-loaders";
import { nodesMongo } from "./models";
import {
  createFolder,
  foldersOf,
  listNodes,
  moveNodes,
  ownedNode,
  pathTo,
  renameNode,
  rootsOf,
} from "./services";
import {
  nameOf,
  nodeView,
  recordFolderCreate,
  recordMove,
  recordRename,
} from "./utils";

export const nodesResolvers: Resolvers = {
  Folder: { owner: (node, _, ctx) => ownerOf(node, ctx) },
  Query: {
    roots: async (_, __, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const roots = await rootsOf(nodesMongo(scope.mongo), principal.accountId);
      return roots.map(nodeView);
    },
    folders: async (_, { parentId }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const folders = await foldersOf(
        nodesMongo(scope.mongo),
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
      const path = await pathTo(
        nodesMongo(scope.mongo),
        id,
        principal.accountId,
      );
      return path.map(nodeView);
    },
    node: async (_, { id }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      return nodeView(
        await ownedNode(nodesMongo(scope.mongo), id, principal.accountId),
      );
    },
    nodes: async (_, { parentId, filter, sort, first, after }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const page = await listNodes(nodesMongo(scope.mongo), {
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
          hasPreviousPage: typeof after === "string",
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
      const node = await createFolder(nodesMongo(scope.mongo), {
        parentId,
        name: nameOf(name),
        accountId: principal.accountId,
      });
      await recordFolderCreate(
        {
          workspaceId: scope.tenant.id,
          actor: memberActor(principal),
          ip: ctx.ip,
          auditor: ctx.audit,
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
      const { node, before } = await renameNode(nodesMongo(scope.mongo), {
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
          auditor: ctx.audit,
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
      const moved = await moveNodes(nodesMongo(scope.mongo), {
        ids,
        parentId,
        accountId: principal.accountId,
      });
      const done = {
        workspaceId: scope.tenant.id,
        actor: memberActor(principal),
        ip: ctx.ip,
        auditor: ctx.audit,
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
