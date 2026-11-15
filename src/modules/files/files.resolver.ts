import { requireWorkspacePermission } from "@/core/access";
import { memberActor } from "@/core/audit";
import type { WorkspacesMongo } from "@/core/workspaces";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { invalidInput } from "@/i18n/fail";
import { checkName, nodeView } from "@/modules/nodes/public";
import {
  recordCopy,
  recordFileAdd,
  recordFileUpdate,
  recordQuotaRefusal,
} from "./files.audit";
import { copyNodes } from "./files.copy";
import { notAFile } from "./files.errors";
import { checkTags, MAX_META_BYTES, metaFits } from "./files.rules";
import { addFile, type FilesMongo, isQuotaExceeded } from "./files.service";
import { updateFile } from "./files.update";

export const filesResolvers: Resolvers = {
  Mutation: {
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
      };
      let node: Awaited<ReturnType<typeof addFile>>;
      try {
        node = await addFile(
          scope.mongo as unknown as FilesMongo,
          ctx.tenancy.core as WorkspacesMongo,
          ctx.media,
          {
            workspaceId: scope.tenant.id,
            accountId: principal.accountId,
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
      await recordFileAdd(done, node);
      return nodeView(node) as never;
    },
    copyNodes: async (_, { ids, parentId }, ctx) => {
      const { principal, scope } = await requireWorkspacePermission(
        ctx,
        "nodes:manage",
      );
      const copies = await copyNodes(
        scope.mongo as unknown as FilesMongo,
        ctx.tenancy.core as WorkspacesMongo,
        {
          ids,
          parentId,
          accountId: principal.accountId,
          workspaceId: scope.tenant.id,
        },
      );
      const done = {
        workspaceId: scope.tenant.id,
        actor: memberActor(principal),
        ip: ctx.ip,
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
      const { node } = await updateFile(scope.mongo as unknown as FilesMongo, {
        id,
        accountId: principal.accountId,
        ...(tags && { tags }),
        ...(meta !== undefined && { meta: meta as Record<string, unknown> }),
        ...(input.version != null && { version: input.version }),
      });
      await recordFileUpdate(
        {
          workspaceId: scope.tenant.id,
          actor: memberActor(principal),
          ip: ctx.ip,
        },
        node,
        [
          ...(tags ? ["tags" as const] : []),
          ...(meta !== undefined ? ["meta" as const] : []),
        ],
      );
      const view = nodeView(node);
      if (view.__typename !== "File") throw notAFile();
      return view;
    },
  },
};
