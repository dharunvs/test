import * as vscode from "vscode";

import { getValidAccessToken } from "./login.js";
import { ApiClient } from "../services/api-client.js";

const API_BASE_URL = process.env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1";

export async function runCreateHandoff(context: vscode.ExtensionContext): Promise<void> {
  const taskId = context.workspaceState.get<string>("branchline.currentTaskId");
  if (!taskId) {
    vscode.window.showErrorMessage("No active Branchline task found. Start a task before creating a handoff.");
    return;
  }

  const token = await getValidAccessToken(context);
  if (!token) {
    vscode.window.showErrorMessage("Branchline login is required. Run 'Branchline: Login'.");
    return;
  }

  const api = new ApiClient(API_BASE_URL, token);
  const handoff = await api.createTaskHandoff(taskId);

  await context.workspaceState.update("branchline.lastHandoffId", handoff.id);

  vscode.window.showInformationMessage(`Branchline handoff created: ${handoff.summary}`);
}
