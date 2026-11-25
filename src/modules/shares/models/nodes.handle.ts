import type { RoleNode } from "../rules";

// A node as the grants read it: the shape `roleOn` needs, its type and its
// name (the audit trail's), and the owner.
export interface NodeRef extends RoleNode {
  type: string;
  name: string;
}

// The slice of the nodes collection this module reads. The `nodes` module owns
// the collection and depends on this one (its guards ask `roleOn`), so this
// module reads the one row it shares through a structural handle instead of
// importing the module back.
export interface NodesRead {
  db: {
    nodes: {
      findFirst(filter: Record<string, unknown>): Promise<NodeRef | undefined>;
    };
  };
}

// The cast below is the deliberate exception to "no `as` at a call site": it
// lives in this one handle function because nodes depends on shares, so the
// typed nodes handle cannot be imported here without a cycle.
// The one place a workspace database becomes that read handle (as
// `sharesMongo` is for the module's own collection).
export const nodesRead = (database: unknown): NodesRead =>
  database as NodesRead;
