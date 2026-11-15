import { NAME_COLLATION } from "./nodes.collection";
import { familyOf } from "./nodes.family";
import { MAX_DEPTH } from "./nodes.rules";
import {
  depthOf,
  type NodeDoc,
  type NodesMongo,
  ownedFolder,
  tooDeep,
} from "./nodes.service";

export type OnConflict = "REFUSE" | "KEEP_BOTH";

export interface NewFile {
  parentId: string;
  accountId: string;
  name: string;
  onConflict: OnConflict;
  blobKey: string;
  mimeType: string;
  size: number;
}

// The most `name (n).ext` tried before giving up; a folder holding that many
// copies of one name is refused as `name-taken`.
const MAX_COPIES = 1_000;
const MAX_NAME = 255;

// `report (2).pdf` from `report.pdf`: the number goes before the last
// extension; a name with none, or that only starts with a dot, takes it last.
export function copyName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  const [stem, extension] =
    dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  const suffix = ` (${n})${extension}`;
  return `${stem.slice(0, Math.max(1, MAX_NAME - suffix.length))}${suffix}`;
}

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

// A file node under a folder of the caller's tree, in the caller's
// transaction (which has locked the tree: `lockTree`). `REFUSE` leaves a name
// clash to the unique index (`name-taken`); `KEEP_BOTH` renames the new file.
export async function insertFile(
  tx: NodesMongo,
  input: NewFile,
): Promise<NodeDoc> {
  const parent = await ownedFolder(tx, input.parentId, input.accountId);
  if (depthOf(parent) + 1 > MAX_DEPTH) throw tooDeep();
  const name =
    input.onConflict === "KEEP_BOTH"
      ? await freeName(tx, parent, input.name)
      : input.name;
  return tx.db.nodes.as(input.accountId).create({
    type: "FILE",
    name,
    parentId: parent._id,
    ancestors: [...parent.ancestors, parent._id],
    ownerId: parent.ownerId,
    blobKey: input.blobKey,
    mimeType: input.mimeType,
    size: input.size,
    family: familyOf(input.mimeType),
    status: "READY",
  });
}
