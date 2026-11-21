import { requireMember } from "@softistx/alxia-access";
import type { MediaDenial } from "@softistx/alxia-media";
import { GraphQLError } from "graphql";
import { apiRefusal } from "@/core/access/refusals";
import type { MediaRequires } from "./storage.context";
import type { FileReader } from "./storage.keys";

// Who may touch /media: a member of the request's workspace (the
// `x-storix-workspace` header), through a session. A personal API key is
// refused until keys are bound to workspaces. The refusals are denials the
// routes' `refusal` hook words as catalogue codes (storage.refusal.ts).
export type Access =
  | {
      ok: true;
      workspaceId: string;
      accountId: string;
      // The workspace's scope: its database, for the module that knows keys.
      scope: { readonly mongo: unknown };
    }
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
      scope,
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

// Reads of a kind that is not recorded as files (avatars): a member of the
// workspace; the key's own workspace is the prefix, so another workspace's key
// is a missing object.
export async function authorizeRead(ctx: MediaRequires) {
  const access = await accessOf(ctx);
  return access.ok ? true : access.denial;
}

// Reads of `files`: a member of the workspace, and a key some node of the
// caller's tree holds (the check is `files`'s, passed in: storage.keys.ts). An
// object nobody recorded, another member's file and a missing key are one 404.
export async function authorizeFileRead(
  ctx: MediaRequires,
  key: string,
  fileReader: FileReader,
) {
  const access = await accessOf(ctx);
  if (!access.ok) return access.denial;
  const allowed = await fileReader(access.scope.mongo, {
    key,
    accountId: access.accountId,
  });
  return allowed ? true : { code: "not_found", status: 404 };
}

// `workspaces/<id>`, so a request reaches only its own workspace's objects
// (plan §3.4). A caller who is no member gets a prefix that holds nothing.
export async function keyPrefix(ctx: MediaRequires): Promise<string> {
  const access = await accessOf(ctx);
  return access.ok ? `workspaces/${access.workspaceId}` : "workspaces/none";
}
