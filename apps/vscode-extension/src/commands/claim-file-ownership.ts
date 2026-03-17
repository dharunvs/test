import * as vscode from "vscode";

import { getValidAccessToken } from "./login.js";
import { ApiClient } from "../services/api-client.js";
import { getWorkspaceBinding } from "../services/workspace-binding.js";

const API_BASE_URL = process.env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1";

export async function runClaimFileOwnership(context: vscode.ExtensionContext): Promise<void> {
  const binding = getWorkspaceBinding(context);
  if (!binding) {
    vscode.window.showErrorMessage("Branchline workspace is not bound. Run 'Branchline: Bind Workspace'.");
    return;
  }

  const taskId = context.workspaceState.get<string>("branchline.currentTaskId");
  if (!taskId) {
    vscode.window.showErrorMessage("No active Branchline task found. Start a task before claiming ownership.");
    return;
  }

  const token = await getValidAccessToken(context);
  if (!token) {
    vscode.window.showErrorMessage("Branchline login is required. Run 'Branchline: Login'.");
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("Open a file before claiming ownership.");
    return;
  }

  const scopeValue = vscode.workspace.asRelativePath(editor.document.uri, false);
  if (!scopeValue) {
    vscode.window.showErrorMessage("Could not resolve the active file path for ownership claim.");
    return;
  }

  const ttlChoice = await vscode.window.showQuickPick(
    [
      { label: "60 minutes", ttlMinutes: 60 },
      { label: "120 minutes", ttlMinutes: 120 },
      { label: "240 minutes", ttlMinutes: 240 }
    ],
    {
      title: "Ownership claim duration"
    }
  );

  if (!ttlChoice) {
    return;
  }

  const api = new ApiClient(API_BASE_URL, token);
  const claim = await api.claimOwnership({
    orgId: binding.orgId,
    projectId: binding.projectId,
    taskId,
    scopeType: "file",
    scopeValue,
    ttlMinutes: ttlChoice.ttlMinutes
  });

  vscode.window.showInformationMessage(
    `Branchline ownership claim active for ${claim.scopeValue} until ${new Date(claim.expiresAt).toLocaleString()}.`
  );
}
