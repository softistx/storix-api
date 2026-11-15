export { workspacesModule } from "./module";
export {
  DEFAULT_QUOTA_BYTES,
  GIB,
} from "./workspaces.collection";
export {
  type Workspace,
  workspaceOf,
  workspaceRegistry,
} from "./workspaces.registry";
export {
  activeWorkspaceName,
  createWorkspace,
  type Provisioner,
  type WorkspacesMongo,
} from "./workspaces.service";
export {
  addUsage,
  hasRoom,
  quotaExceeded,
  type Storage,
  setQuota,
  setUsage,
  storageOf,
  type Usage,
} from "./workspaces.usage";
