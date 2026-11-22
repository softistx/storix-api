import { invitationResolvers } from "@softistx/janus-graphql";
import type {
  InvitationHooks,
  InvitationResolverMap,
} from "../../identity.port";
import {
  eachField,
  type InvitationCtx,
  invitationLink,
  roleLabel,
} from "../../utils/invitations.utils";
import type { Accounts } from "../janus/janus.accounts";
import type { Mail } from "../janus/janus.mail";

// The janus-graphql resolvers of the invitation fields over this identity.
// `auth` is the janus instance; `hooks` is what the application decides (who
// may invite where, what a scope is called). The resolvers run on the
// request's own context, to which `janus` is added: the signed-in account, or
// 401 `auth.errors.api-key-not-accepted` for a personal API key (a key is
// never a member). The code is answered to nobody but the invitee's inbox
// (`sendInvitation`), and a new invitee's session as `token` (`answerToken`),
// as the sign-in operations do: the UI's server sets the cookie.
export function createInvitationResolvers<C extends InvitationCtx>(
  auth: Accounts,
  mail: Mail,
  uiOrigin: string,
  hooks: InvitationHooks<C>,
): InvitationResolverMap {
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

  const map = resolvers as unknown as Record<string, Record<string, unknown>>;
  return {
    Query: eachField<C>(map["Query"] ?? {}),
    Mutation: eachField<C>(map["Mutation"] ?? {}),
    JanusInvitationPage: eachField<C>(map["JanusInvitationPage"] ?? {}),
    InvitationAcceptResult: map["InvitationAcceptResult"] as Record<
      string,
      (...args: unknown[]) => unknown
    >,
  };
}
