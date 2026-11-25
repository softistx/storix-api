import { requireWorkspacePermission } from "@/core/access";
import { memberActor } from "@/core/audit";
import { workspacesMongo } from "@/core/workspaces";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { invalidInput } from "@/i18n/fail";
import {
  checkName,
  fileView,
  nodeRoleFields,
  nodeView,
  ownerOf,
} from "@/modules/nodes/public";
import { callerSeat } from "@/modules/shares/public";
import { notAFile } from "../files.errors";
import { filesMongo } from "../models";
import { checkTags, MAX_META_BYTES, metaFits } from "../rules";
import {
  addFile,
  copyNodes,
  listRecent,
  listStarred,
  openFile,
  recordRecent,
  setStarred,
  updateFile,
} from "../services";
import {
  isQuotaExceeded,
  pageOf,
  recordCopy,
  recordFileAdd,
  recordFileUpdate,
  recordQuotaRefusal,
  recordVersion,
} from "../utils";
import { fileRenditionResolvers, setFocalPoint } from "./focal.resolver";
import { fileVersionResolvers, versionMutations } from "./versions.resolver";

export const filesResolvers: Resolvers = {
  Query: {
    starred: async (_, { first, after }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const page = await listStarred(filesMongo(scope.mongo), {
        accountId: principal.accountId,
        first,
        after,
      });
      return pageOf(page, after);
    },
    recentFiles: async (_, { first, after }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const page = await listRecent(filesMongo(scope.mongo), {
        accountId: principal.accountId,
        first,
        after,
      });
      return pageOf(page, after);
    },
  },
  File: {
    ...fileRenditionResolvers,
    ...fileVersionResolvers,
    owner: (node, _, ctx) => ownerOf(node, ctx),
    ...nodeRoleFields,
  },
  Mutation: {
    ...versionMutations,
    setFocalPoint,
    setStarred: async (_, { id, starred }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const node = await setStarred(filesMongo(scope.mongo), {
        id,
        starred,
        accountId: await callerSeat(scope, principal.accountId),
      });
      return nodeView(node);
    },
    openFile: async (_, { id }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:read",
      );
      const node = await openFile(filesMongo(scope.mongo), {
        id,
        accountId: await callerSeat(scope, principal.accountId),
      });
      const view = nodeView(node);
      if (view.__typename !== "File") throw notAFile();
      return view;
    },
    addFile: async (_, { input }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const checked = checkName(input.name);
      if ("issue" in checked) {
        throw invalidInput([
          {
            path: "input.name",
            code: checked.issue,
            ...(checked.issue === "validation.errors.too-short" && {
              params: { min: 1 },
            }),
          },
        ]);
      }
      const done = {
        workspaceId: scope.tenant.id,
        actor: memberActor(principal),
        ip: ctx.ip,
        auditor: ctx.audit,
      };
      let added: Awaited<ReturnType<typeof addFile>>;
      try {
        added = await addFile(
          filesMongo(scope.mongo),
          workspacesMongo(ctx.tenancy.core),
          ctx.media,
          ctx.renditions,
          {
            workspaceId: scope.tenant.id,
            accountId: await callerSeat(scope, principal.accountId),
            key: input.key,
            name: checked.name,
            parentId: input.parentId,
            onConflict: input.onConflict ?? "REFUSE",
          },
        );
      } catch (error) {
        if (isQuotaExceeded(error)) await recordQuotaRefusal(done, input.name);
        throw error;
      }
      const { node, appended } = added;
      if (appended === null) await recordFileAdd(done, node);
      else
        await recordVersion(done, "file.version-add", node, {
          number: appended,
        });
      await ctx.notify.usage({ scope });
      // An upload is a recent file; the upload stands if the note fails.
      await recordRecent(filesMongo(scope.mongo), {
        accountId: principal.accountId,
        nodeId: node._id,
      }).catch((error) =>
        console.error(
          `storix-api: could not note the upload ${node.id} as recent: ${error instanceof Error ? error.message : error}`,
        ),
      );
      const view = nodeView(node);
      if (view.__typename !== "File") throw notAFile();
      return view;
    },
    copyNodes: async (_, { ids, parentId }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const copies = await copyNodes(
        filesMongo(scope.mongo),
        workspacesMongo(ctx.tenancy.core),
        {
          ids,
          parentId,
          accountId: await callerSeat(scope, principal.accountId),
          workspaceId: scope.tenant.id,
        },
      );
      const done = {
        workspaceId: scope.tenant.id,
        actor: memberActor(principal),
        ip: ctx.ip,
        auditor: ctx.audit,
      };
      for (const { node, from } of copies) {
        await recordCopy(done, node, from);
      }
      return copies.map(({ node }) => nodeView(node));
    },
    updateFile: async (_, { id, input }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const issues = [];
      let tags: string[] | undefined;
      if (input.tags) {
        const checked = checkTags(input.tags);
        if ("issue" in checked) {
          issues.push({
            path: "input.tags",
            code: checked.issue,
            params: { max: checked.max },
          });
        } else {
          tags = checked.tags;
        }
      }
      const meta = input.meta ?? undefined;
      if (meta !== undefined && !metaFits(meta)) {
        issues.push({
          path: "input.meta",
          code: "validation.errors.too-long" as const,
          params: { max: MAX_META_BYTES },
        });
      }
      if (issues.length > 0) throw invalidInput(issues);
      const { node } = await updateFile(filesMongo(scope.mongo), {
        id,
        accountId: await callerSeat(scope, principal.accountId),
        ...(tags && { tags }),
        ...(meta !== undefined && { meta: meta as Record<string, unknown> }),
        ...(typeof input.version === "number" && { version: input.version }),
      });
      await recordFileUpdate(
        {
          workspaceId: scope.tenant.id,
          actor: memberActor(principal),
          ip: ctx.ip,
          auditor: ctx.audit,
        },
        node,
        [
          ...(tags ? ["tags" as const] : []),
          ...(meta !== undefined ? ["meta" as const] : []),
        ],
      );
      return fileView(node);
    },
  },
};
