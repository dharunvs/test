import * as vscode from "vscode";

import { getValidAccessToken } from "../commands/login.js";
import { ApiClient } from "./api-client.js";
import { getWorkspaceBinding } from "./workspace-binding.js";

const API_BASE_URL = process.env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1";

export function startActivityPublisher(context: vscode.ExtensionContext): vscode.Disposable {
  const publish = async () => {
    const binding = getWorkspaceBinding(context);
    if (!binding) {
      return;
    }

    const token = await getValidAccessToken(context);
    if (!token) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    const activeFilePath = editor?.document.uri.fsPath;

    const api = new ApiClient(API_BASE_URL, token);
    await api.updatePresence({
      orgId: binding.orgId,
      projectId: binding.projectId,
      repositoryId: binding.repositoryId,
      taskId: context.workspaceState.get<string>("branchline.currentTaskId"),
      branchId: context.workspaceState.get<string>("branchline.currentBranchId"),
      state: "editing",
      activeFilePath
    });
  };

  const interval = setInterval(() => {
    void publish();
  }, 15000);

  const editorDisposable = vscode.window.onDidChangeActiveTextEditor(() => {
    void publish();
  });

  void publish();

  return new vscode.Disposable(() => {
    clearInterval(interval);
    editorDisposable.dispose();
  });
}
