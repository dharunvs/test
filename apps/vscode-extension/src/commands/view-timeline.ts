import * as vscode from "vscode";

import { getValidAccessToken } from "./login.js";
import { ApiClient } from "../services/api-client.js";

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
  const timeline = await api.fetchTaskTimeline(taskId);

  const markdown = [
    "# Branchline Timeline",
    "",
    `- Task: \`${timeline.taskId}\``,
    timeline.counts
      ? `- Counts: intent=${timeline.counts.intentEvents}, decisions=${timeline.counts.decisions}, activity=${timeline.counts.activityEvents}, quality=${timeline.counts.qualityRuns}, handoffs=${timeline.counts.handoffs}, conflicts=${timeline.counts.conflicts}, branches=${timeline.counts.branches}`
      : null,
    "",
    "## Events",
    ...timeline.timeline.map(
      (entry, index) =>
        `${index + 1}. \`${new Date(entry.timestamp).toLocaleString()}\` - \`${entry.category}\` - \`${entry.type}\` (\`${entry.id}\`)`
    )
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: markdown
  });

  await vscode.window.showTextDocument(document, {
    preview: false
  });
}

