import { randomUUID } from "node:crypto";

import * as vscode from "vscode";

import { getValidAccessToken } from "./login.js";
import {
  appendCommitMetadataTrailers,
  createAndCheckoutBranch,
  getHeadCommitSha,
  getCurrentGitBranch,
  getPrimaryRemoteUrl,
  listChangedPaths,
  pushBranch
} from "../services/branch-orchestrator.js";
import { ApiClient } from "../services/api-client.js";
import { buildIntentEvent } from "../services/event-emitter.js";
import { nextIntentSequence } from "../services/intent-sequence.js";
import { getWorkspaceBinding } from "../services/workspace-binding.js";

const API_BASE_URL = process.env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1";

function normalizeRepoFullNameFromRemote(url: string): string | undefined {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  // Supports: git@github.com:owner/repo.git and https://github.com/owner/repo.git
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

  const changedPaths = await listChangedPaths(workspaceFolder);
  if (changedPaths.length > 0) {
    const guardrailResult = await api.evaluateGuardrails({
      projectId: binding.projectId,
      taskId: task.id,
      stage: "pre_apply",
      changedPaths
    });

    if (guardrailResult.blocking) {
      const firstViolation = guardrailResult.violations[0];
      vscode.window.showErrorMessage(
        firstViolation
          ? `Guardrail blocked task start (${guardrailResult.stage}): ${firstViolation.message}`
          : "Guardrail policy blocked task start."
      );
      return;
    }
  }

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

  const runId = randomUUID();
  const intentId = randomUUID();

  await appendCommitMetadataTrailers(workspaceFolder, runId, task.id, intentId);
  const commitSha = await getHeadCommitSha(workspaceFolder);

  if (commitSha) {
    await api.ingestCommitMetadata({
      orgId: binding.orgId,
      projectId: binding.projectId,
      taskId: task.id,
      branchId: branchResponse.branch.id,
      runId,
      intentId,
      commitSha,
      provider: "extension",
      model: "local"
    });
  }

  let ensuredPullRequest = branchResponse.pullRequest ?? null;

  if (branchResponse.policy.autoPush) {
    await pushBranch(workspaceFolder, branchResponse.branch.name);

    if (branchResponse.policy.autoPr) {
      try {
        const ensured = await api.ensureBranchPullRequest(branchResponse.branch.id, {
          title: `AI Task: ${taskTitle}`,
          draft: true
        });
        ensuredPullRequest = ensured.pullRequest;

        if (!ensured.pullRequest && ensured.reason) {
          vscode.window.showWarningMessage(`Branchline auto-PR could not be ensured: ${ensured.reason}`);
        }
      } catch (error) {
        vscode.window.showWarningMessage(
          `Branchline auto-PR request failed: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }
  }

  const intentEvent = buildIntentEvent({
    orgId: binding.orgId,
    projectId: binding.projectId,
    repositoryId: binding.repositoryId,
    taskId: task.id,
    branchId: branchResponse.branch.id,
    type: "intent.task_started",
    payload: {
      taskTitle,
      fromBranch: currentBranch,
      createdBranch: branchResponse.branch.name,
      runId,
      intentId,
      pullRequestId: ensuredPullRequest?.id
    },
    sequence: await nextIntentSequence(context, task.id)
  });

  await api.sendIntentEvent(intentEvent);

  await context.workspaceState.update("branchline.currentRunId", runId);
  await context.workspaceState.update("branchline.currentTaskId", task.id);
  await context.workspaceState.update("branchline.currentBranchId", branchResponse.branch.id);

  vscode.window.showInformationMessage(
    ensuredPullRequest
      ? `Branchline task started on ${branchResponse.branch.name} (PR #${ensuredPullRequest.number} prepared).`
      : `Branchline task started on ${branchResponse.branch.name}.`
  );
}
