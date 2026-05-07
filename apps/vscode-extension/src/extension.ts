import * as vscode from "vscode";

import { runBindWorkspace } from "./commands/bind-workspace.js";
import { runLogin } from "./commands/login.js";
import { runStartAiTask } from "./commands/start-ai-task.js";
import { runViewTimeline } from "./commands/view-timeline.js";

export function activate(context: vscode.ExtensionContext) {
  const loginDisposable = vscode.commands.registerCommand("branchline.login", () => runLogin(context));
  const bindDisposable = vscode.commands.registerCommand("branchline.bindWorkspace", () =>
    runBindWorkspace(context)
  );
  const startTaskDisposable = vscode.commands.registerCommand("branchline.startAiTask", () =>
    runStartAiTask(context)
  );
  const viewTimelineDisposable = vscode.commands.registerCommand("branchline.viewTimeline", () =>
    runViewTimeline(context)
  );

  context.subscriptions.push(loginDisposable, bindDisposable, startTaskDisposable, viewTimelineDisposable);
}

export function deactivate() {
  // no-op
}

