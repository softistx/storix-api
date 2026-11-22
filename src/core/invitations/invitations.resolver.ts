import type { Resolvers } from "@/generated/graphql/resolvers";
import { recordInvitationAccept } from "./services";
import {
  audited,
  codeLimit,
  type Field,
  field,
  type Previewed,
  preview,
} from "./utils";

export const invitationsResolvers = {
  Query: {
    invitations: field("Query", "invitations"),
    invitationPreview: (async (parent, args, ctx, info) => {
      await codeLimit(ctx);
      return preview(parent, args, ctx, info);
    }) as Field,
  },
  Mutation: {
    issueInvitation: audited("issueInvitation", "issue"),
    resendInvitation: audited("resendInvitation", "resend"),
    revokeInvitation: audited("revokeInvitation", "revoke"),
    acceptInvitation: (async (parent, args, ctx, info) => {
      await codeLimit(ctx);
      // The preview gives the reason; a code that lapses or is spent between
      // it and janus's own accept still answers a bare `invalid`.
      const previewed = (await preview(parent, args, ctx, info)) as Previewed;
      const answer = await field("Mutation", "acceptInvitation")(
        parent,
        args,
        ctx,
        info,
      );
      await recordInvitationAccept(ctx, previewed, answer);
      return answer;
    }) as Field,
  },
  JanusInvitationPage: {
    totalCount: field("JanusInvitationPage", "totalCount"),
  },
  InvitationAcceptResult: {
    __resolveType: (result: { status: string }) =>
      result.status === "signedIn"
        ? "InvitationSignedIn"
        : result.status === "secondFactor"
          ? "InvitationSecondFactor"
          : "InvitationSignIn",
  },
} as unknown as Resolvers;
