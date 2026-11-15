import { StoreFailure } from "@softistx/janus";
import {
  invitationResolvers,
  janusInvitationTypeDefs,
  janusTypeDefs,
} from "@softistx/janus-graphql";
import { GraphQLError } from "graphql";
import { fail, forbidden, invalidInput, unauthenticated } from "@/i18n/fail";
import type {
  InvitationHooks,
  InvitationResolverMap,
  Principal,
} from "./identity.port";
import type { Accounts } from "./janus.accounts";
import { tooShort, unavailable } from "./janus.errors";
import type { Mail } from "./janus.mail";

// The SDL of the invitation fields, as `@softistx/janus-graphql` ships it:
// `invitations`, `issueInvitation`, `resendInvitation`, `revokeInvitation`,
// `invitationPreview`, `acceptInvitation`. Only this folder imports janus.
// The SDL carries janus's directive declarations (`@authenticated`…): they do
// nothing here, `authorize` is the guard.
export const invitationTypeDefs: string = `${janusTypeDefs}\n${janusInvitationTypeDefs}`;

// janus-graphql's refusals as the API answers them: the code says what the
// client can act on, never which of janus's reasons it was (an unknown, spent,
// revoked or lapsed code is one `invitations.errors.invalid`).
export function invitationRefusal(error: GraphQLError): GraphQLError {
  const code = error.extensions["code"];
  const field = error.extensions["field"];
  switch (code) {
    case "UNAUTHENTICATED":
      return unauthenticated();
    case "FORBIDDEN":
    case "USER_INACTIVE":
      return forbidden();
    case "NOT_FOUND":
      return fail("invitations.errors.not-found", { status: 404 });
    case "INVITATION_INVALID":
    case "BAD_USER_INPUT":
    case "USER_INVALID":
      return typeof field === "string" && field !== "code"
        ? invalidInput([{ path: field, code: "validation.errors.invalid" }])
        : fail("invitations.errors.invalid", { status: 400 });
    case "INVITATION_LIMIT":
      return fail("invitations.errors.limit", { status: 409 });
    case "INVITATION_NOT_PENDING":
      return fail("invitations.errors.not-pending", { status: 409 });
    case "INVITATION_REFUSED":
      return forbidden();
    case "PASSWORD_REQUIRED":
      return fail("invitations.errors.password-required", {
        status: 400,
        field: "password",
      });
    case "PASSWORD_TOO_SHORT":
      return tooShort(
        typeof error.extensions["minLength"] === "number"
          ? error.extensions["minLength"]
          : 8,
      );
    case "SERVICE_UNAVAILABLE":
      return unavailable();
    default:
      return error;
  }
}

const roleLabel = (role: string) =>
  role.charAt(0) + role.slice(1).toLowerCase();

// Where the invitee accepts: a page of storix-ui that spends nothing (it
// previews the code and posts it back from a button). The code rides in the
// fragment, which a browser never sends to a server and a proxy never logs.
export const invitationLink = (uiOrigin: string, code: string) =>
  `${uiOrigin}/invitations/accept#${code}`;

interface Ctx {
  viewer: Principal | null;
}

// The janus-graphql resolvers of the invitation fields over this identity.
// `auth` is the janus instance; `hooks` is what the application decides (who
// may invite where, what a scope is called). The resolvers run on the
// request's own context, to which `janus` is added: the signed-in account, or
// 401 `auth.errors.api-key-not-accepted` for a personal API key (a key is
// never a member). The code is answered to nobody but the invitee's inbox
// (`sendInvitation`), and a new invitee's session as `token` (`answerToken`),
// as the sign-in operations do: the UI's server sets the cookie.
export function createInvitationResolvers<C extends Ctx>(
  auth: Accounts,
  mail: Mail,
  uiOrigin: string,
  hooks: InvitationHooks<C>,
): InvitationResolverMap {
  const janusOf = (ctx: C) => ({
    janus: {
      user: async () => {
        if (!ctx.viewer) return null;
        if (ctx.viewer.apiKeyId !== null) {
          throw fail("auth.errors.api-key-not-accepted", { status: 401 });
        }
        return { type: "user", id: ctx.viewer.accountId };
      },
    },
  });
  const withJanus = (ctx: C) =>
    Object.assign(Object.create(ctx) as object, janusOf(ctx));

  const resolvers = invitationResolvers({
    auth,
    answerToken: true,
    authorize: (action, subject, ctx) =>
      hooks.authorize(
        action,
        {
          scope: subject.scope,
          ...(subject.input && {
            input: { email: subject.input.email, role: subject.input.role },
          }),
          ...(subject.invitation && {
            invitation: {
              email: subject.invitation.email,
              role: subject.invitation.role,
            },
          }),
        },
        ctx as unknown as C,
      ),
    describeScope: (scope, ctx) =>
      hooks.describeScope(scope, ctx as unknown as C),
    sendInvitation: async ({ invitation, code }, ctx) => {
      const viewer = (ctx as unknown as C).viewer;
      const organization = await hooks.describeScope(
        invitation.scope,
        ctx as unknown as C,
      );
      await mail.invitation(
        {
          email: invitation.email,
          name: invitation.name,
          ...(invitation.locale !== null && { locale: [invitation.locale] }),
        },
        {
          ...(viewer && { inviter: viewer.name }),
          organization: organization?.name ?? "storix",
          role: roleLabel(invitation.role),
          link: invitationLink(uiOrigin, code),
          expiresAt: invitation.expiresAt,
        },
      );
    },
  });

  // Each field on the context with `janus`, its refusals as the API's own.
  type Field = (parent: unknown, args: unknown, ctx: unknown) => unknown;
  const each = (fields: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(fields).map(([name, resolve]) => [
        name,
        async (parent: unknown, args: unknown, ctx: unknown) => {
          try {
            return await (resolve as Field)(parent, args, withJanus(ctx as C));
          } catch (error) {
            if (error instanceof StoreFailure) throw unavailable();
            if (error instanceof GraphQLError) throw invitationRefusal(error);
            throw error;
          }
        },
      ]),
    );

  const map = resolvers as unknown as Record<string, Record<string, unknown>>;
  return {
    Query: each(map["Query"] ?? {}),
    Mutation: each(map["Mutation"] ?? {}),
    JanusInvitationPage: each(map["JanusInvitationPage"] ?? {}),
    InvitationAcceptResult: map["InvitationAcceptResult"] as Record<
      string,
      (...args: unknown[]) => unknown
    >,
  };
}
