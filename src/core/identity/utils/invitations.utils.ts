import { StoreFailure } from "@softistx/janus";
import { GraphQLError } from "graphql";
import { apiKeyNotAccepted } from "@/i18n/fail";
import type { Principal } from "../identity.port";
import { invitationRefusal } from "../services/invitations/invitations.refusal";
import { unavailable } from "../services/janus/janus.errors";

export interface InvitationCtx {
  viewer: Principal | null;
}

export const roleLabel = (role: string) =>
  role.charAt(0) + role.slice(1).toLowerCase();

// Where the invitee accepts: a page of storix-ui that spends nothing (it
// previews the code and posts it back from a button). The code rides in the
// fragment, which a browser never sends to a server and a proxy never logs.
export const invitationLink = (uiOrigin: string, code: string) =>
  `${uiOrigin}/invitations/accept#${code}`;

// The request's own context with `janus` added: the signed-in account, or 401
// `auth.errors.api-key-not-accepted` for a personal API key (a key is never a
// member).
export const withJanus = <C extends InvitationCtx>(ctx: C) =>
  Object.assign(Object.create(ctx) as object, {
    janus: {
      user: async () => {
        if (!ctx.viewer) return null;
        if (ctx.viewer.apiKeyId !== null) {
          throw apiKeyNotAccepted();
        }
        return { type: "user", id: ctx.viewer.accountId };
      },
    },
  });

// Each field on the context with `janus`, its refusals as the API's own.
type Field = (parent: unknown, args: unknown, ctx: unknown) => unknown;
export const eachField = <C extends InvitationCtx>(
  fields: Record<string, unknown>,
) =>
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
