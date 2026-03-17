import * as vscode from "vscode";

const ORG_ID_KEY = "branchline.orgId";
const PROJECT_ID_KEY = "branchline.projectId";
const REPO_ID_KEY = "branchline.repositoryId";
const REPO_FULL_NAME_KEY = "branchline.repositoryFullName";
const WORKSPACE_HASH_KEY = "branchline.workspaceHash";

export interface WorkspaceBinding {
  orgId: string;
  projectId: string;
  repositoryId: string;
  repositoryFullName?: string;
  workspaceHash?: string;
}

export function getWorkspaceBinding(context: vscode.ExtensionContext): WorkspaceBinding | null {
  const orgId = context.workspaceState.get<string>(ORG_ID_KEY);
  const projectId = context.workspaceState.get<string>(PROJECT_ID_KEY);
  const repositoryId = context.workspaceState.get<string>(REPO_ID_KEY);
  const repositoryFullName = context.workspaceState.get<string>(REPO_FULL_NAME_KEY);
  const workspaceHash = context.workspaceState.get<string>(WORKSPACE_HASH_KEY);

  if (!orgId || !projectId || !repositoryId) {
    return null;
  }

  return { orgId, projectId, repositoryId, repositoryFullName, workspaceHash };
}

export async function setWorkspaceBinding(
  context: vscode.ExtensionContext,
  binding: WorkspaceBinding
): Promise<void> {
  await context.workspaceState.update(ORG_ID_KEY, binding.orgId);
  await context.workspaceState.update(PROJECT_ID_KEY, binding.projectId);
  await context.workspaceState.update(REPO_ID_KEY, binding.repositoryId);
  await context.workspaceState.update(REPO_FULL_NAME_KEY, binding.repositoryFullName);
  await context.workspaceState.update(WORKSPACE_HASH_KEY, binding.workspaceHash);
}
