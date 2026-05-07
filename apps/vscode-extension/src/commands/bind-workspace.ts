import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import * as vscode from "vscode";

import { getValidAccessToken } from "./login.js";
import { ApiClient } from "../services/api-client.js";
import { setWorkspaceBinding } from "../services/workspace-binding.js";

const API_BASE_URL = process.env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1";
const WEB_CONSOLE_BASE_URL = process.env.BRANCHLINE_WEB_CONSOLE_BASE_URL ?? "http://localhost:3000";

function hashWorkspacePath(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}

function runGit(workspacePath: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: workspacePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
}

function detectRepositoryFromWorkspace(workspacePath: string):
  | {
      provider: "github" | "gitlab";
      owner: string;
      name: string;
      defaultBranch: string;
    }
  | undefined {
  const remoteUrl = runGit(workspacePath, ["remote", "get-url", "origin"]);
  if (!remoteUrl) {
    return undefined;
  }

  const match = remoteUrl.match(/^(?:https?:\/\/|git@)(github\.com|gitlab\.com)[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) {
    return undefined;
  }

  const host = match[1]?.toLowerCase();
  const owner = match[2];
  const name = match[3];
  if (!owner || !name) {
    return undefined;
  }

  const provider = host === "gitlab.com" ? "gitlab" : "github";
  const defaultBranch = runGit(workspacePath, ["branch", "--show-current"]) || "main";

  return {
    provider,
    owner,
    name,
    defaultBranch
  };
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
    const action = await vscode.window.showErrorMessage(
      "No organizations found for this account. Complete onboarding in Branchline web console, then retry.",
      "Open Branchline"
    );
    if (action === "Open Branchline") {
      await vscode.env.openExternal(vscode.Uri.parse(`${WEB_CONSOLE_BASE_URL}/projects`));
    }
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

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) {
    vscode.window.showErrorMessage("Open a workspace folder before binding.");
    return;
  }

  const repositoryOverride = process.env.BRANCHLINE_E2E_REPOSITORY_ID?.trim();
  let repositories = await api.listRepositories(selectedProject.projectId);
  if (repositories.length === 0) {
    if (repositoryOverride) {
      vscode.window.showErrorMessage(`Configured repository override was not found: ${repositoryOverride}`);
      return;
    }

    const action = await vscode.window.showWarningMessage(
      "No repositories are linked to this project yet.",
      "Link Current Repo",
      "Open Branchline"
    );

    if (action === "Open Branchline") {
      await vscode.env.openExternal(vscode.Uri.parse(`${WEB_CONSOLE_BASE_URL}/projects`));
      return;
    }

    if (action !== "Link Current Repo") {
      return;
    }

    const detected = detectRepositoryFromWorkspace(workspacePath);
    if (!detected) {
      vscode.window.showErrorMessage(
        "Could not detect a GitHub/GitLab origin remote for this workspace. Link the repository in Branchline web console."
      );
      return;
    }

    await api.bindRepository({
      projectId: selectedProject.projectId,
      provider: detected.provider,
      owner: detected.owner,
      name: detected.name,
      defaultBranch: detected.defaultBranch,
      isPrivate: true
    });

    repositories = await api.listRepositories(selectedProject.projectId);
    if (repositories.length === 0) {
      vscode.window.showErrorMessage("Repository link did not complete. Try again from Branchline web console.");
      return;
    }
  }

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
