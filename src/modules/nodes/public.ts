// The nodes surface: the module, and what the `files` module records a file
// with. Everything else in this folder is private.

export type { NodeDoc, NodeState, NodesMongo } from "./models";
export { nodesMongo } from "./models";
export { nodesModule, nodesOnHandover, nodesOnJoin } from "./module";
export {
  cycle,
  moveTooLarge,
  named,
  nameTaken,
  nodeNotFound,
  rootLocked,
  tooDeep,
} from "./nodes.errors";
export { ownerOf } from "./nodes.owner";
export type { FileFamily } from "./rules";
export {
  checkName,
  decodeCursor,
  encodeCursor,
  familyOf,
  MAX_DEPTH,
  MAX_MOVE_NODES,
} from "./rules";
export type { NewFile, OnConflict } from "./services";
export {
  assertMovable,
  ensureRoot,
  freeName,
  insertFile,
  lockTree,
  moveOne,
  ownedFolder,
  ownedNode,
  sameNameSibling,
} from "./services";
export { copyName, depthOf, type FileNode, fileView, nodeView } from "./utils";
