import { tenancy, WORKSPACE_HEADER } from "@/config/tenancy";
import { members } from "@/config/wiring";
import { harness } from "@/core/identity/identity.harness";
import { joinWorkspace } from "@/core/invitations";
import {
  addMember,
  type MembersMongo,
  memberJoined,
  type WorkspaceRole,
} from "@/core/members";
import type { WorkspacesMongo } from "@/core/workspaces";
import type { Limits } from "@/http/rate-limits";

export { WORKSPACE_HEADER };

type HarnessOptions = NonNullable<Parameters<typeof harness>[0]>;

type User = Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["account"]>>;

export interface Gql {
  data?: Record<string, unknown> | null | undefined;
  errors?: { extensions?: { code?: string } }[] | undefined;
  response: { status: number };
}

// The identity harness plus workspaces: accounts that own or join workspaces,
// and a `send` that speaks as one of them to one workspace (or none).
export async function world(
  options: {
    limits?: Limits;
    media?: HarnessOptions["media"];
    renditions?: HarnessOptions["renditions"];
    // A wiring other than the server's (specs: a listener that fails).
    members?: HarnessOptions["members"];
    audit?: HarnessOptions["audit"];
  } = {},
) {
  const h = await harness({
    ...(options.limits && { limits: options.limits }),
    ...(options.media && { media: options.media }),
    ...(options.renditions && { renditions: options.renditions }),
    ...(options.members && { members: options.members }),
    ...(options.audit && { audit: options.audit }),
    onAcceptedInvitation: (accepted) =>
      joinWorkspace(
        tenancy.core as MembersMongo,
        accepted,
        options.members ?? members,
      ),
  });
  let sequence = 0;
  const slug = () => `ws-${++sequence}-${crypto.randomUUID().slice(0, 6)}`;

  // `workspace` is the header's value (an id or a slug); undefined sends none.
  async function send(
    user: User | null,
    query: string,
    options: { workspace?: string; variables?: Record<string, unknown> } = {},
  ) {
    const headers: Record<string, string> = { ...(user?.headers ?? {}) };
    if (options.workspace) headers[WORKSPACE_HEADER] = options.workspace;
    const result = await h.client.query<Record<string, never>>(query, {
      ...(options.variables && { variables: options.variables }),
      headers,
    });
    // biome-ignore lint/suspicious/noExplicitAny: a spec reads whatever the query asked for
    return result as unknown as Gql & { data: Record<string, any> | null };
  }

  const codeOf = (result: Gql) => result.errors?.[0]?.extensions?.code;

  // A new account creates a workspace and owns it.
  async function workspaceOf(owner?: User) {
    const user = owner ?? (await h.account());
    const name = slug();
    const result = await send(
      user,
      `mutation($input: CreateWorkspaceInput!) { createWorkspace(input: $input) { id slug name myRole } }`,
      { variables: { input: { name: `Name ${name}`, slug: name } } },
    );
    if (result.errors) throw new Error(JSON.stringify(result.errors));
    const created = result.data?.["createWorkspace"] as {
      id: string;
      slug: string;
    };
    return { owner: user, id: created.id, slug: created.slug };
  }

  // A new account that belongs to a workspace with a role; its member id too.
  async function join(
    workspace: { id: string; owner: User },
    role: WorkspaceRole,
  ) {
    const user = await h.account();
    const row = await addMember(tenancy.core as MembersMongo, {
      workspaceId: workspace.id,
      accountId: user.principal.accountId,
      role,
      actorId: workspace.owner.principal.accountId,
    });
    await memberJoined(options.members ?? members, row);
    return { user, memberId: row.id };
  }

  // The member id of an account in a workspace, read as its owner does.
  async function memberIdOf(
    workspace: { id: string; owner: User },
    account: User,
  ) {
    const page = await send(
      workspace.owner,
      "{ members(first: 100) { nodes { id accountId } } }",
      { workspace: workspace.id },
    );
    const nodes = page.data?.["members"].nodes as {
      id: string;
      accountId: string;
    }[];
    const found = nodes.find(
      (n) => n.accountId === account.principal.accountId,
    );
    if (!found) throw new Error("not a member");
    return found.id;
  }

  // Closes a workspace as the tenancy lifecycle does: it is no longer active.
  async function archive(workspace: { id: string; owner: User }) {
    const mongo = tenancy.core as unknown as WorkspacesMongo;
    const doc = await mongo.db.workspaces.findById(workspace.id);
    if (!doc) throw new Error("no such workspace");
    await mongo.db.workspaces
      .as(workspace.owner.principal.accountId)
      .update(workspace.id, { status: "archived", version: doc.version });
  }

  return { h, send, codeOf, workspaceOf, join, memberIdOf, slug, archive };
}
