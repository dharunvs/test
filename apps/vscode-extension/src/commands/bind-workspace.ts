import { createHash } from "node:crypto";

import * as vscode from "vscode";

import { getValidAccessToken } from "./login.js";
import { ApiClient } from "../services/api-client.js";
import { setWorkspaceBinding } from "../services/workspace-binding.js";

const API_BASE_URL = process.env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1";

function hashWorkspacePath(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}

export async function runBindWorkspace(context: vscode.ExtensionContext): Promise<void> {
  const token = await getValidAccessToken(context);
  if (!token) {
    vscode.window.showErrorMessage("Branchline login is required. Run 'Branchline: Login'.");
    return;
  }

  const api = new ApiClient(API_BASE_URL, token);

  const organizations = await api.listOrganizations();
  if (organizations.length === 0) {
    vscode.window.showErrorMessage("No organizations found for this account.");
    return;
  }

  const orgOverride = process.env.BRANCHLINE_E2E_ORG_ID?.trim();
  const selectedOrg = orgOverride
    ? (() => {
        const match = organizations.find((org) => org.id === orgOverride);
        if (!match) {
          return undefined;
        }
        return {
          label: match.name,
          description: `${match.slug} (${match.role})`,
          orgId: match.id
        };
      })()
    : await vscode.window.showQuickPick(
        organizations.map((org) => ({
          label: org.name,
          description: `${org.slug} (${org.role})`,
          orgId: org.id
        })),
        {
          title: "Select Branchline organization"
        }
      );

  if (!selectedOrg) {
    if (orgOverride) {
      vscode.window.showErrorMessage(`Configured org override was not found: ${orgOverride}`);
    }
    return;
  }

  const projects = await api.listProjects(selectedOrg.orgId);
  if (projects.length === 0) {
    vscode.window.showErrorMessage("No projects found in selected organization.");
    return;
  }

  const projectOverride = process.env.BRANCHLINE_E2E_PROJECT_ID?.trim();
  const selectedProject = projectOverride
    ? (() => {
        const match = projects.find((project) => project.id === projectOverride);
        if (!match) {
          return undefined;
        }
        return {
          label: match.name,
          description: match.key,
          projectId: match.id
        };
      })()
    : await vscode.window.showQuickPick(
        projects.map((project) => ({
          label: project.name,
          description: project.key,
          projectId: project.id
        })),
        {
          title: "Select Branchline project"
        }
      );

  if (!selectedProject) {
    if (projectOverride) {
      vscode.window.showErrorMessage(`Configured project override was not found: ${projectOverride}`);
    }
    return;
  }

  const repositories = await api.listRepositories(selectedProject.projectId);
  if (repositories.length === 0) {
    vscode.window.showErrorMessage("No repositories linked to this project.");
    return;
  }

  const repositoryOverride = process.env.BRANCHLINE_E2E_REPOSITORY_ID?.trim();
  const selectedRepository = repositoryOverride
    ? (() => {
        const match = repositories.find((repository) => repository.id === repositoryOverride);
        if (!match) {
          return undefined;
        }
        return {
          label: match.fullName,
          description: `${match.provider} • default ${match.defaultBranch}`,
          repositoryId: match.id
        };
      })()
    : await vscode.window.showQuickPick(
        repositories.map((repository) => ({
          label: repository.fullName,
          description: `${repository.provider} • default ${repository.defaultBranch}`,
          repositoryId: repository.id
        })),
        {
          title: "Select repository"
        }
      );

  if (!selectedRepository) {
    if (repositoryOverride) {
      vscode.window.showErrorMessage(`Configured repository override was not found: ${repositoryOverride}`);
    }
    return;
  }

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) {
    vscode.window.showErrorMessage("Open a workspace folder before binding.");
    return;
  }

  const validation = await api.validateWorkspaceMapping({
    projectId: selectedProject.projectId,
    repositoryId: selectedRepository.repositoryId
  });

  if (!validation.valid) {
    vscode.window.showErrorMessage("Repository is not linked to this project in Branchline.");
    return;
  }

  const workspaceHash = hashWorkspacePath(workspacePath);
  await api.bindWorkspace({
    orgId: selectedOrg.orgId,
    projectId: selectedProject.projectId,
    repositoryId: selectedRepository.repositoryId,
    workspaceHash,
    extensionVersion: "0.1.0",
    vscodeVersion: vscode.version,
    os: process.platform
  });

  await setWorkspaceBinding(context, {
    orgId: selectedOrg.orgId,
    projectId: selectedProject.projectId,
    repositoryId: selectedRepository.repositoryId,
    repositoryFullName: selectedRepository.label,
    workspaceHash
  });

  vscode.window.showInformationMessage("Branchline workspace binding saved.");
}
