export { workspacesModule } from "./module";
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
