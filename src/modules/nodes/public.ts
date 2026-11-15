// The nodes surface: the module, and what the `files` module records a file
// with. Everything else in this folder is private.
export { nodesModule } from "./module";
export type { FileFamily } from "./nodes.family";
export { familyOf } from "./nodes.family";
export {
  copyName,
  insertFile,
  type NewFile,
  type OnConflict,
} from "./nodes.file";
export { checkName } from "./nodes.rules";
export {
  depthOf,
  lockTree,
  type NodeDoc,
  type NodesMongo,
  named,
  nameTaken,
  ownedFolder,
  tooDeep,
} from "./nodes.service";
export { nodeView } from "./nodes.tree";
