import type { Resolvers } from "@/generated/graphql/resolvers";
import type { Context } from "@/http/context";
import { fail } from "@/i18n/fail";
import type { Identity, InvitationResolverMap } from "../identity";
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

const preview: Field = async (parent, args, ctx, info) => {
  const resolve = resolversOf(ctx)["Query"]?.["invitationPreview"];
  if (!resolve)
    throw new Error("no invitation resolver Query.invitationPreview");
  const answer = (await resolve(parent, args, ctx, info)) as {
    organization: string | null;
  };
  if (answer.organization === null) throw closed();
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
    issueInvitation: field("Mutation", "issueInvitation"),
    resendInvitation: field("Mutation", "resendInvitation"),
    revokeInvitation: field("Mutation", "revokeInvitation"),
    acceptInvitation: (async (parent, args, ctx, info) => {
      await codeLimit(ctx);
      await preview(parent, args, ctx, info);
      return field("Mutation", "acceptInvitation")(parent, args, ctx, info);
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
