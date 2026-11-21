import type { BaseContext, StatusCode } from "@softistx/alxia";
import type { MediaRefusal } from "@softistx/alxia-media";
import type { ErrorCode } from "@/i18n/codes";
import { fail } from "@/i18n/fail";
import type { Params } from "@/i18n/params";

interface Mapped {
  code: ErrorCode;
  params?: Params;
}

const MIB = 1024 * 1024;

// A media refusal as an API code (plan §3.13).
function codeOf(refusal: MediaRefusal): Mapped {
  switch (refusal.code) {
    case "unauthenticated":
      return { code: "auth.errors.unauthenticated" };
    case "forbidden":
      return { code: "auth.errors.forbidden" };
    case "api_key_not_accepted":
      return { code: "auth.errors.api-key-not-accepted" };
    case "workspace_required":
      return { code: "workspaces.errors.workspace-required" };
    case "not_found":
      return { code: "storage.errors.not-found" };
    case "unsupported_type":
      return { code: "storage.errors.unsupported-type" };
    case "too_large":
      return {
        code: "storage.errors.too-large",
        params: { limitMib: Math.floor((refusal.details.limit ?? 0) / MIB) },
      };
    case "empty_body":
      return { code: "storage.errors.empty" };
    case "size_mismatch":
    case "interrupted":
      return { code: "storage.errors.interrupted" };
    case "stalled":
      return { code: "storage.errors.stalled" };
    case "range_not_satisfiable":
      return { code: "storage.errors.range-not-satisfiable" };
    case "throttled":
      return {
        code: "storage.errors.rate-limited",
        params: { seconds: refusal.details.retryAfter ?? 1 },
      };
    case "quota_exceeded":
      return { code: "quotas.errors.exceeded" };
    case "unprocessable":
      return { code: "storage.errors.unprocessable" };
    case "invalid_crop":
      return { code: "validation.errors.invalid" };
    default:
      return { code: "storage.errors.unavailable" };
  }
}

// The `refusal` hook of the media routes: the body is /graphql's error shape,
// `{ errors: [{ message, extensions: { code, params? } }] }`, with the
// refusal's own status. Cached nowhere (the package sends `no-store`).
export function refusalReply(refusal: MediaRefusal, ctx: BaseContext) {
  const { code, params } = codeOf(refusal);
  const error = fail(code, params ? { params } : {});
  const extensions: Record<string, unknown> = { ...error.extensions };
  if (refusal.code === "throttled" && refusal.details.retryAfter) {
    extensions["retryAfter"] = refusal.details.retryAfter;
    ctx.set.headers.set("retry-after", String(refusal.details.retryAfter));
  }
  if (refusal.details.accept) extensions["accept"] = refusal.details.accept;
  return ctx.reply(refusal.status as StatusCode, {
    errors: [{ message: error.message, extensions }],
  });
}
