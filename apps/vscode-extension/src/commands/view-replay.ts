import * as vscode from "vscode";

import { getValidAccessToken } from "./login.js";
import { ApiClient } from "../services/api-client.js";

const API_BASE_URL = process.env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1";

export async function runViewReplay(context: vscode.ExtensionContext): Promise<void> {
  const token = await getValidAccessToken(context);
  if (!token) {
    vscode.window.showErrorMessage("Branchline login is required. Run 'Branchline: Login'.");
    return;
  }

  const taskId =
    context.workspaceState.get<string>("branchline.currentTaskId") ??
    (await vscode.window.showInputBox({
      title: "Replay Task ID",
      placeHolder: "Paste task id to load replay",
      ignoreFocusOut: true
    }));

  if (!taskId) {
    return;
  }

  const api = new ApiClient(API_BASE_URL, token);
  const replay = await api.fetchReplay(taskId);

  const markdown = [
    `# Branchline Replay`,
    ``,
    `- Task: \`${replay.taskId}\``,
    `- Snapshot Version: \`${replay.snapshotVersion}\``,
    `- Generated At: \`${new Date(replay.generatedAt).toLocaleString()}\``,
    ``,
    `## Steps`,
    ...replay.steps.map((step, index) => `${index + 1}. ${step}`)
  ].join("\n");

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: markdown
  });

  await vscode.window.showTextDocument(document, {
    preview: false
  });
}
