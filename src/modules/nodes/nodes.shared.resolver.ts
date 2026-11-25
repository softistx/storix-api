import { requireWorkspacePermission } from "@/core/access";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { callerSeat } from "@/modules/shares/public";
import { sharedByMe, sharedWithMe } from "./services";
import { nodeView } from "./utils";

type Listing = typeof sharedWithMe;

const listing =
  (
    read: Listing,
  ): NonNullable<NonNullable<Resolvers["Query"]>["sharedWithMe"]> =>
  async (_, { first, after }, ctx) => {
    const { principal, scope } = await requireWorkspacePermission(
      ctx,
      "nodes:read",
    );
    const page = await read(scope.mongo, {
      who: await callerSeat(scope, principal.accountId),
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
  };

// `sharedWithMe` and `sharedByMe`: the topmost shared nodes, one page.
export const sharedQueries = {
  sharedWithMe: listing(sharedWithMe),
  sharedByMe: listing(sharedByMe),
};
