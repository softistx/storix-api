import { requireMember } from "@alxia/access";
import type { MediaDenial } from "@alxia/media";
import { GraphQLError } from "graphql";
import { apiRefusal } from "@/core/access/refusals";
import type { MediaRequires } from "./storage.context";

// Who may touch /media: a member of the request's workspace (the
// `x-storix-workspace` header), through a session. A personal API key is
// refused until keys are bound to workspaces. The refusals are denials the
// routes' `refusal` hook words as catalogue codes (storage.refusal.ts).
export type Access =
  | { ok: true; workspaceId: string; accountId: string }
  | { ok: false; denial: MediaDenial };

export async function accessOf(ctx: MediaRequires): Promise<Access> {
  const viewer = ctx.viewer;
  if (!viewer) return { ok: false, denial: { code: "unauthenticated" } };
  if (viewer.apiKeyId !== null) {
    return {
      ok: false,
      denial: { code: "api_key_not_accepted", status: 401 },
    };
  }
  try {
    const scope = await requireMember(ctx.guard);
    return {
      ok: true,
      workspaceId: scope.tenant.id,
      accountId: viewer.accountId,
    };
  } catch (error) {
    const mapped = apiRefusal(error);
    const code =
      mapped instanceof GraphQLError ? mapped.extensions["code"] : undefined;
    if (code === "workspaces.errors.workspace-required") {
      return { ok: false, denial: { code: "workspace_required", status: 400 } };
    }
    // An unknown workspace and one the caller is not in are the same 404.
    return { ok: false, denial: { code: "not_found", status: 404 } };
  }
}

// Writes: any member may upload; what may be recorded is `addFile`'s to check.
export async function authorizeWrite(ctx: MediaRequires) {
  const access = await accessOf(ctx);
  return access.ok ? true : access.denial;
}

// Reads: a member of the workspace; the key's own workspace is the prefix, so
// another workspace's key is a missing object. Slice A9 narrows it to the
// nodes the caller may read.
export async function authorizeRead(ctx: MediaRequires) {
  const access = await accessOf(ctx);
  return access.ok ? true : access.denial;
}

// `workspaces/<id>`, so a request reaches only its own workspace's objects
// (plan §3.4). A caller who is no member gets a prefix that holds nothing.
export async function keyPrefix(ctx: MediaRequires): Promise<string> {
  const access = await accessOf(ctx);
  return access.ok ? `workspaces/${access.workspaceId}` : "workspaces/none";
}
