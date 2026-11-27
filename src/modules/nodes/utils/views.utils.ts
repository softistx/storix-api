import type { NodeDoc } from "../models";

// A `File` as `nodeView` makes it, without the fields the files module
// resolves (`renditions`, `rendition`): the parent of its resolvers.
export type FileNode = Extract<
  ReturnType<typeof nodeView>,
  { __typename: "File" }
>;

// A `Folder` as `nodeView` makes it, without the fields resolved apart
// (`owner`, `myRole`, `grants`): the parent of its resolvers.
export type FolderNode = Extract<
  ReturnType<typeof nodeView>,
  { __typename: "Folder" }
>;

const commonOf = (node: NodeDoc) => ({
  id: node.id,
  type: node.type,
  name: node.name,
  parentId: node.parentId?.toHexString() ?? null,
  ancestors: node.ancestors.map((a) => a.toHexString()),
  ownerId: node.ownerId ?? null,
  depth: node.ancestors.length + 1,
  version: node.version,
  createdAt: node.createdAt,
  updatedAt: node.updatedAt,
  trashedAt: node.trashedAt ?? null,
  trashedBy: node.trashedBy ?? null,
});

// The crops' own status: the file's while the file is not `READY` (its
// full job makes them too), else the redo's (`cropsStatus`), `READY` when none.
export const cropsStatusOf = (node: NodeDoc) =>
  node.status && node.status !== "READY"
    ? node.status
    : (node.cropsStatus ?? "READY");

// A file node as the API says it, for a caller that knows the node is one (it
// has just written a file): no type to narrow.
export const fileView = (node: NodeDoc) => ({
  __typename: "File" as const,
  ...commonOf(node),
  key: node.blobKey ?? "",
  mimeType: node.mimeType ?? "application/octet-stream",
  size: node.size ?? 0,
  family: node.family ?? "OTHER",
  tags: node.tags,
  meta: node.meta,
  status: node.status ?? "READY",
  cropsStatus: cropsStatusOf(node),
  focalPoint: node.focalPoint,
});

// The node as the API says it: a `Folder`, or a `File` with what the storage
// reported (`__typename` picks the type of the `Node` interface).
export const nodeView = (node: NodeDoc) =>
  node.type === "FOLDER"
    ? { __typename: "Folder" as const, ...commonOf(node) }
    : fileView(node);

// A listing's answer: the nodes as views and the page info a cursor page
// carries (the end cursor is null on the last page).
export function nodePage(
  page: { items: Parameters<typeof nodeView>[0][]; endCursor: string | null },
  after: string | null | undefined,
) {
  return {
    nodes: page.items.map(nodeView),
    pageInfo: {
      startCursor: null,
      endCursor: page.endCursor,
      hasNextPage: page.endCursor !== null,
      hasPreviousPage: typeof after === "string",
    },
  };
}
