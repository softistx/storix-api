import { requireWorkspacePermission } from "@/core/access";
import { callerSeat } from "@/core/members";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { sharedByMe, sharedWithMe } from "./services";
import { nodePage } from "./utils";

// `sharedWithMe` and `sharedByMe`: the topmost shared nodes, one page.
export const sharedQueries: Pick<
  NonNullable<Resolvers["Query"]>,
  "sharedWithMe" | "sharedByMe"
> = {
  sharedWithMe: async (_, { first, after }, ctx) => {
    const { principal, scope } = await requireWorkspacePermission(
      ctx,
      "nodes:read",
    );
    const who = await callerSeat(scope, principal.accountId);
    return nodePage(
      await sharedWithMe(scope.mongo, { who, first, after }),
      after,
    );
  },
  sharedByMe: async (_, { first, after }, ctx) => {
    const { principal, scope } = await requireWorkspacePermission(
      ctx,
      "nodes:read",
    );
    const who = await callerSeat(scope, principal.accountId);
    return nodePage(
      await sharedByMe(scope.mongo, { who, first, after }),
      after,
    );
  },
};
