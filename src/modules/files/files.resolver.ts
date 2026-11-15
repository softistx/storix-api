import { requireWorkspacePermission } from "@/core/access";
import { memberActor } from "@/core/audit";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { invalidInput } from "@/i18n/fail";
import { checkName, nodeView } from "@/modules/nodes/public";
import { recordFileAdd } from "./files.audit";
import { addFile, type FilesMongo } from "./files.service";

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
      const node = await addFile(
        scope.mongo as unknown as FilesMongo,
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
      await recordFileAdd(
        {
          workspaceId: scope.tenant.id,
          actor: memberActor(principal),
          ip: ctx.ip,
        },
        node,
      );
      return nodeView(node) as never;
    },
  },
};
