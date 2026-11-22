import type { Context } from "@/http/context";
import type { SignInOptions, SignInResult } from "../identity.port";
import { viewerOf } from "./viewer.utils";

// What the session list shows for the sign-in: the client's User-Agent.
export const deviceOf = (ctx: Context): SignInOptions => {
  const agent = ctx.request.headers.get("user-agent")?.trim();
  return agent ? { deviceLabel: agent } : {};
};

export const payloadOf = (result: SignInResult) => {
  switch (result.status) {
    case "SIGNED_IN":
      return {
        status: result.status,
        token: result.token,
        expiresAt: result.expiresAt,
        viewer: viewerOf(result.principal),
      };
    case "SECOND_FACTOR":
      return {
        status: result.status,
        challenge: result.challenge,
        expiresAt: result.expiresAt,
      };
    case "VERIFICATION_SENT":
      return { status: result.status };
  }
};
