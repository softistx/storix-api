export { workspacesModule } from "./module";
export {
  DEFAULT_QUOTA_BYTES,
  DEFAULT_SETTINGS,
  GIB,
} from "./workspaces.collection";
export { workspacesMongo } from "./workspaces.handle";
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
  type Settings,
  settingsOf,
  updateSettings,
  type WorkspaceView,
} from "./workspaces.settings";
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
