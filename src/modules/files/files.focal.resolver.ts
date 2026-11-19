import { requireWorkspacePermission } from "@/core/access";
import { memberActor } from "@/core/audit";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { nodeView } from "@/modules/nodes/public";
import { recordFileFocal } from "./files.audit";
import { notAFile } from "./files.errors";
import { setFocalPoint as moveFocalPoint } from "./files.focal";
import { filesMongo } from "./files.handle";
import { renditionsOf } from "./files.renditions.list";

// `File.renditions` and `File.rendition(preset)`: derived from the node.
export const fileRenditionResolvers: NonNullable<Resolvers["File"]> = {
  renditions: (file) => renditionsOf(file),
  rendition: (file, { preset }) =>
    renditionsOf(file).find((one) => one.preset === preset) ?? null,
};

// `setFocalPoint` (needs `nodes:manage`), audited as `file.focal`.
export const setFocalPoint: NonNullable<
  NonNullable<Resolvers["Mutation"]>["setFocalPoint"]
> = async (_, { id, focalPoint }, ctx) => {
  const { principal, scope } = await requireWorkspacePermission(
    ctx,
    "nodes:manage",
  );
  const mongo = filesMongo(scope.mongo);
  const { node } = await moveFocalPoint(mongo, ctx.renditions, {
    id,
    accountId: principal.accountId,
    workspaceId: scope.tenant.id,
    focalPoint: focalPoint ?? null,
  });
  await recordFileFocal(
    {
      workspaceId: scope.tenant.id,
      actor: memberActor(principal),
      ip: ctx.ip,
      auditor: ctx.audit,
    },
    node,
  );
  const view = nodeView(node);
  if (view.__typename !== "File") throw notAFile();
  return view;
};
