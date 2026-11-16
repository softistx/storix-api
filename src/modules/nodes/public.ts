// The nodes surface: the module, and what the `files` module records a file
// with. Everything else in this folder is private.
export { nodesModule } from "./module";
export { decodeCursor, encodeCursor } from "./nodes.cursor";
export type { FileFamily } from "./nodes.family";
export { familyOf } from "./nodes.family";
export {
  copyName,
  freeName,
  insertFile,
  type NewFile,
  type OnConflict,
  sameNameSibling,
} from "./nodes.file";
export { nodesMongo } from "./nodes.handle";
export { moveOne } from "./nodes.move";
export { checkName, MAX_DEPTH } from "./nodes.rules";
export {
  cycle,
  depthOf,
  ensureRoot,
  lockTree,
  type NodeDoc,
  type NodeState,
  type NodesMongo,
  named,
  nameTaken,
  nodeNotFound,
  ownedFolder,
  ownedNode,
  rootLocked,
  tooDeep,
} from "./nodes.service";
export { type FileNode, fileView, nodeView } from "./nodes.tree";
