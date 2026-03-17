import * as vscode from "vscode";

import { getValidAccessToken } from "./login.js";
import { ApiClient } from "../services/api-client.js";

const API_BASE_URL = process.env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1";

export async function runAcknowledgeHandoff(
  context: vscode.ExtensionContext,
  handoffIdFromArgs?: string
): Promise<void> {
  const token = await getValidAccessToken(context);
  if (!token) {
    vscode.window.showErrorMessage("Branchline login is required. Run 'Branchline: Login'.");
    return;
  }

  const api = new ApiClient(API_BASE_URL, token);
  const activeTaskId = context.workspaceState.get<string>("branchline.currentTaskId");

  let handoffId: string | undefined = handoffIdFromArgs;

  if (!handoffId && activeTaskId) {
    const task = await api.getTask(activeTaskId);
    if (task.handoffPackets.length > 0) {
      const selected = await vscode.window.showQuickPick(
        task.handoffPackets.map((handoff) => ({
          label: handoff.summary,
          description: `Created ${new Date(handoff.createdAt).toLocaleString()}`,
          handoffId: handoff.id
        })),
        {
          title: "Select handoff to acknowledge"
        }
      );

      handoffId = selected?.handoffId;
    }
  }

  if (!handoffId) {
    handoffId = await vscode.window.showInputBox({
      title: "Handoff ID",
      placeHolder: "Paste handoff packet id",
      ignoreFocusOut: true
    });
  }

  if (!handoffId) {
    return;
  }

  const notes = await vscode.window.showInputBox({
    title: "Acknowledgment notes (optional)",
    placeHolder: "Context received, resuming from replay snapshot",
    ignoreFocusOut: true
  });

  await api.acknowledgeHandoff(handoffId, notes || undefined);
  await context.workspaceState.update("branchline.lastHandoffId", handoffId);

  vscode.window.showInformationMessage("Branchline handoff acknowledged.");
}
