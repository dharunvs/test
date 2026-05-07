import * as vscode from "vscode";

import { getValidAccessToken } from "./login.js";
import { ApiClient } from "../services/api-client.js";
import { flushPendingIntentCaptures } from "../services/intent-capture-queue.js";

const API_BASE_URL = process.env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1";

export async function runViewTimeline(context: vscode.ExtensionContext): Promise<void> {
  const token = await getValidAccessToken(context);
  if (!token) {
    vscode.window.showErrorMessage("Branchline login is required. Run 'Branchline: Login'.");
    return;
  }

  const taskId =
    context.workspaceState.get<string>("branchline.currentTaskId") ??
    (await vscode.window.showInputBox({
      title: "Timeline Task ID",
      placeHolder: "Paste task id to load timeline",
      ignoreFocusOut: true
    }));

  if (!taskId) {
    return;
  }

  const api = new ApiClient(API_BASE_URL, token);
  await flushPendingIntentCaptures(context, api);
  const timeline = await api.fetchIntentTimeline(taskId, 5);

  const markdown = [
    "# Branchline Intent Timeline",
    "",
    `- Task: \`${timeline.taskId}\``,
    `- Events loaded: ${timeline.events.length}`,
    "",
    "## Last 5 Events",
    ...timeline.events.map((entry, index) =>
      [
        `${index + 1}. \`${new Date(entry.timestamp).toLocaleString()}\``,
        `   - Commit: \`${entry.commitId}\``,
        `   - Prompt: ${entry.prompt || "(redacted/empty)"}`,
        `   - AI Output: ${entry.summary || "(redacted/empty)"}`,
        `   - Files: ${entry.files.join(", ") || "none"}`,
        `   - Redaction: ${entry.redactionLevel}`
      ].join("\n")
    )
  ].join("\n");

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: markdown
  });

  await vscode.window.showTextDocument(document, {
    preview: false
  });
}

