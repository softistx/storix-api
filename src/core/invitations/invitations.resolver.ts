import type { Resolvers } from "@/generated/graphql/resolvers";
import type { Context } from "@/http/context";
import { fail } from "@/i18n/fail";
import type { Identity, InvitationResolverMap } from "../identity";
import {
  recordInvitationAccept,
  recordInvitationWrite,
} from "./invitations.audit";
import { invitationHooks } from "./invitations.hooks";

// The resolvers are janus-graphql's, built by the identity port over this
// module's hooks (the identity is the request's, so they are built on first
// use and kept per identity).
const built = new WeakMap<Identity, InvitationResolverMap>();
function resolversOf(ctx: Context): InvitationResolverMap {
  let map = built.get(ctx.identity);
  if (!map) {
    map = ctx.identity.invitations.resolvers(invitationHooks);
    built.set(ctx.identity, map);
  }
  return map;
}

type Field = (
  parent: unknown,
  args: unknown,
  ctx: Context,
  info: unknown,
) => Promise<unknown>;

// One field of janus-graphql's resolvers, after `before` (a limit).
const field =
  (
    type: "Query" | "Mutation" | "JanusInvitationPage",
    name: string,
    before?: (ctx: Context) => Promise<void>,
  ): Field =>
  async (parent, args, ctx, info) => {
    await before?.(ctx);
    const resolve = resolversOf(ctx)[type]?.[name];
    if (!resolve) throw new Error(`no invitation resolver ${type}.${name}`);
    return resolve(parent, args, ctx, info);
  };

// A code of a workspace that is not open (suspended, or not finished
// opening) is as dead as a spent one: `invitations.errors.invalid`, for the
// preview and for the accept alike. The preview names the workspace only when
// it is active, so a null name is that state.
const closed = () => fail("invitations.errors.invalid", { status: 400 });

// The invitation a code names, as the preview answers it.
interface Previewed {
  id: string;
  scope: string;
  email: string;
  name: string;
  role: string;
  organization: string | null;
}

const preview: Field = async (parent, args, ctx, info) => {
  const resolve = resolversOf(ctx)["Query"]?.["invitationPreview"];
  if (!resolve)
    throw new Error("no invitation resolver Query.invitationPreview");
  const answer = (await resolve(parent, args, ctx, info)) as Previewed;
  if (answer.organization === null) throw closed();
  return answer;
};

// A write of janus's, then its audit event: recorded after the write has
// committed, and an event that cannot be recorded never fails the write.
const audited =
  (name: string, action: "issue" | "resend" | "revoke"): Field =>
  async (parent, args, ctx, info) => {
    const answer = await field("Mutation", name)(parent, args, ctx, info);
    await recordInvitationWrite(action, ctx, answer);
    return answer;
  };

// The code is the only secret of the two open fields: counted per address.
const codeLimit = (ctx: Context) => ctx.limits.invitationCode(ctx.ip);

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
