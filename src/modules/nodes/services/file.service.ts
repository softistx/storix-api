import { accountOf, type Who } from "@/core/members";
import { NAME_COLLATION, type NodeDoc, type NodesMongo } from "../models";
import { tooDeep } from "../nodes.errors";
import { familyOf, MAX_DEPTH } from "../rules";
import { copyName, depthOf } from "../utils";
import { folderFor } from "./nodes.service";

export type OnConflict = "REFUSE" | "KEEP_BOTH";

export interface NewFile {
  parentId: string;
  accountId: Who;
  name: string;
  onConflict: OnConflict;
  blobKey: string;
  mimeType: string;
  size: number;
  // `PROCESSING` while the worker makes the previews; `READY` when none are made.
  status?: "READY" | "PROCESSING";
}

// The most `name (n).ext` tried before giving up; a folder holding that many
// copies of one name is refused as `name-taken`.
const MAX_COPIES = 1_000;

// The first of `name`, `name (1)`, `name (2)`… that no live sibling holds,
// ignoring case. Two writers racing for it are settled by the unique index.
export async function freeName(tx: NodesMongo, parent: NodeDoc, name: string) {
  const taken = async (candidate: string) =>
    Boolean(
      await tx.db.nodes.findFirst(
        { parentId: parent._id, name: candidate, trashedAt: null },
        { collation: NAME_COLLATION },
      ),
    );
  if (!(await taken(name))) return name;
  for (let n = 1; n <= MAX_COPIES; n++) {
    const candidate = copyName(name, n);
    if (!(await taken(candidate))) return candidate;
  }
  return name;
}

// The live node of a folder of the caller's tree that has this name, ignoring
// case (`NEW_VERSION` looks for the file a new upload replaces); the folder
// must be the caller's (`not-found`, `not-a-folder`).
export async function sameNameSibling(
  tx: NodesMongo,
  input: { parentId: string; accountId: Who; name: string },
): Promise<NodeDoc | undefined> {
  const parent = await folderFor(tx, input.parentId, input.accountId, "EDITOR");
  return tx.db.nodes.findFirst(
    { parentId: parent._id, name: input.name, trashedAt: null },
    { collation: NAME_COLLATION },
  );
}

// A file node under a folder of the caller's tree, in the caller's
// transaction (which has locked the tree: `lockTree`). `REFUSE` leaves a name
// clash to the unique index (`name-taken`); `KEEP_BOTH` renames the new file.
export async function insertFile(
  tx: NodesMongo,
  input: NewFile,
): Promise<NodeDoc> {
  const parent = await folderFor(tx, input.parentId, input.accountId, "EDITOR");
  if (depthOf(parent) + 1 > MAX_DEPTH) throw tooDeep();
  const name =
    input.onConflict === "KEEP_BOTH"
      ? await freeName(tx, parent, input.name)
      : input.name;
  return tx.db.nodes.as(accountOf(input.accountId)).create({
    type: "FILE",
    name,
    parentId: parent._id,
    ancestors: [...parent.ancestors, parent._id],
    ownerId: parent.ownerId,
    blobKey: input.blobKey,
    mimeType: input.mimeType,
    size: input.size,
    family: familyOf(input.mimeType),
    status: input.status ?? "READY",
    ...(input.status === "PROCESSING" && { renditionsAt: new Date() }),
  });
}
