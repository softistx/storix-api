// Every code the API answers with, in module order: the inventory. Each module
// declares its own codes in its `<module>.errors.ts`; this file only gathers
// them. tsc refuses a code that is not in it (`fail`, `FieldIssue`), the
// coverage spec requires a message for each in every shipped language and a row
// in CONTEXT.md, and that every registered module's `codes` are in it. A slice
// that adds a module with codes adds its `codes` here, beside the manifest's.
import { identity } from "@/core/identity/identity.errors";
import { invitations } from "@/core/invitations/invitations.errors";
import { members } from "@/core/members/members.errors";
import { storage } from "@/core/storage/storage.errors";
import { auth, validation } from "@/core/system/system.errors";
import { workspaces } from "@/core/workspaces/workspaces.errors";
import { files, versions } from "@/modules/files/files.errors";
import { nodes } from "@/modules/nodes/nodes.errors";
import { quotas } from "@/modules/quotas/quotas.errors";
import { teams } from "@/modules/teams/teams.errors";
import { trash } from "@/modules/trash/trash.errors";

export const errorCodes = [
  ...auth,
  ...validation,
  ...identity,
  ...workspaces,
  ...members,
  ...invitations,
  ...teams,
  ...nodes,
  ...files,
  ...versions,
  ...trash,
  ...quotas,
  ...storage,
] as const;

export type ErrorCode = (typeof errorCodes)[number];
