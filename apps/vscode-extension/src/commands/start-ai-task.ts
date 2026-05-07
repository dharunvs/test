import * as vscode from "vscode";

import { getValidAccessToken } from "./login.js";
import {
  createAndCheckoutBranch,
  getHeadCommitSha,
  getCurrentGitBranch,
  getPrimaryRemoteUrl,
  listChangedPaths,
  pushBranch
} from "../services/branch-orchestrator.js";
import { ApiClient } from "../services/api-client.js";
import { enqueueIntentCapture, flushPendingIntentCaptures } from "../services/intent-capture-queue.js";
import { getWorkspaceBinding } from "../services/workspace-binding.js";

const API_BASE_URL = process.env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1";

function normalizeRepoFullNameFromRemote(url: string): string | undefined {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const sshMatch = trimmed.match(/github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  const httpsMatch = trimmed.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  return undefined;
}

export async function runStartAiTask(context: vscode.ExtensionContext): Promise<void> {
  const binding = getWorkspaceBinding(context);
  if (!binding) {
    vscode.window.showErrorMessage("Branchline workspace is not bound. Run 'Branchline: Bind Workspace'.");
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("Open a workspace folder before starting an AI task.");
    return;
  }

  const configuredTaskTitle = process.env.BRANCHLINE_E2E_TASK_TITLE?.trim();
  const taskTitle = configuredTaskTitle
    ? configuredTaskTitle
    : await vscode.window.showInputBox({
        title: "Start AI Task",
        placeHolder: "Task title",
        ignoreFocusOut: true
      });

  if (!taskTitle || taskTitle.trim().length === 0) {
    return;
  }

  const configuredPrompt = process.env.BRANCHLINE_E2E_INTENT_PROMPT?.trim();
  const prompt = configuredPrompt
    ? configuredPrompt
    : await vscode.window.showInputBox({
        title: "Prompt Used",
        placeHolder: "What prompt did you use with AI?",
        ignoreFocusOut: true
      });

  if (!prompt || prompt.trim().length === 0) {
    return;
  }

  const configuredSummary = process.env.BRANCHLINE_E2E_INTENT_SUMMARY?.trim();
  const summary = configuredSummary
    ? configuredSummary
    : await vscode.window.showInputBox({
        title: "AI Output Summary",
        placeHolder: "Summarize AI output in one sentence",
        ignoreFocusOut: true
      });

  if (!summary || summary.trim().length === 0) {
    return;
  }

  const token = await getValidAccessToken(context);
  if (!token) {
    vscode.window.showErrorMessage("Branchline login is required. Run 'Branchline: Login'.");
    return;
  }

  const api = new ApiClient(API_BASE_URL, token);

  const mappingValidation = await api.validateWorkspaceMapping({
    projectId: binding.projectId,
    repositoryId: binding.repositoryId,
    workspaceHash: binding.workspaceHash
  });

  if (!mappingValidation.valid) {
    vscode.window.showErrorMessage(
      "Workspace binding is no longer valid for this project/repository or workspace hash. Re-run 'Branchline: Bind Workspace'."
    );
    return;
  }

  if (binding.repositoryFullName) {
    const remoteUrl = await getPrimaryRemoteUrl(workspaceFolder);
    const remoteFullName = remoteUrl ? normalizeRepoFullNameFromRemote(remoteUrl) : undefined;
    if (remoteFullName && remoteFullName !== binding.repositoryFullName) {
      vscode.window.showErrorMessage(
        `Local repository mismatch. Expected ${binding.repositoryFullName}, found ${remoteFullName}.`
      );
      return;
    }
  }

  const currentBranch = await getCurrentGitBranch(workspaceFolder);
  const task = await api.startTask({
    orgId: binding.orgId,
    projectId: binding.projectId,
    repositoryId: binding.repositoryId,
    title: taskTitle
  });

  const branchResponse = await api.createBranch({
    projectId: binding.projectId,
    taskId: task.id,
    ticketOrTask: task.id,
    taskSlug: taskTitle,
    currentBranch
  });

  if (branchResponse.blocked || !branchResponse.branch) {
    vscode.window.showWarningMessage(
      branchResponse.reason ?? "Branchline blocked AI edits on a protected branch."
    );
    return;
  }

  await createAndCheckoutBranch(
    workspaceFolder,
    branchResponse.branch.name,
    branchResponse.policy.baseBranch
  );

  if (branchResponse.policy.autoPush) {
    await pushBranch(workspaceFolder, branchResponse.branch.name);
  }

  const changedPaths = await listChangedPaths(workspaceFolder);
  const commitId = (await getHeadCommitSha(workspaceFolder)) ?? "uncommitted";
  const files = changedPaths.length > 0 ? changedPaths : ["(none)"];

  await flushPendingIntentCaptures(context, api);

  try {
    await api.captureIntent({
      taskId: task.id,
      prompt: prompt.trim(),
      summary: summary.trim(),
      files,
      commitId
    });
  } catch (error) {
    await enqueueIntentCapture(context, {
      taskId: task.id,
      prompt: prompt.trim(),
      summary: summary.trim(),
      files,
      commitId,
      queuedAt: new Date().toISOString()
    });
    vscode.window.showWarningMessage(
      `Intent capture queued offline: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  await context.workspaceState.update("branchline.currentTaskId", task.id);
  await context.workspaceState.update("branchline.currentBranchId", branchResponse.branch.id);

  vscode.window.showInformationMessage(`Branchline task started on ${branchResponse.branch.name}.`);
}

