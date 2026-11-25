import { requireWorkspacePermission } from "@/core/access";
import { memberActor } from "@/core/audit";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { callerSeat } from "@/modules/shares/public";
import { ownerOf } from "./data-loaders";
import { nodesMongo } from "./models";
import { nodeRoleFields } from "./nodes.roles.resolver";
import {
  createFolder,
  foldersOf,
  listNodes,
  moveNodes,
  nodeFor,
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
  Folder: { owner: (node, _, ctx) => ownerOf(node, ctx), ...nodeRoleFields },
  Query: {
    roots: async (_, __, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const roots = await rootsOf(
        nodesMongo(scope.mongo),
        await callerSeat(scope, principal.accountId),
      );
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
        await callerSeat(scope, principal.accountId),
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
        await callerSeat(scope, principal.accountId),
      );
      return path.map(nodeView);
    },
    node: async (_, { id }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      return nodeView(
        await nodeFor(
          nodesMongo(scope.mongo),
          id,
          await callerSeat(scope, principal.accountId),
          "VIEWER",
        ),
      );
    },
    nodes: async (_, { parentId, filter, sort, first, after }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const page = await listNodes(nodesMongo(scope.mongo), {
        parentId,
        accountId: await callerSeat(scope, principal.accountId),
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
        accountId: await callerSeat(scope, principal.accountId),
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
        accountId: await callerSeat(scope, principal.accountId),
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
        accountId: await callerSeat(scope, principal.accountId),
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
