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
} from "./nodes.file";
export { checkName } from "./nodes.rules";
export {
  cycle,
  depthOf,
  lockTree,
  type NodeDoc,
  type NodesMongo,
  named,
  nameTaken,
  nodeNotFound,
  ownedFolder,
  ownedNode,
  rootLocked,
  tooDeep,
} from "./nodes.service";
export { type FileNode, nodeView } from "./nodes.tree";
