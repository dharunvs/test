import * as vscode from "vscode";

import { runAcknowledgeHandoff } from "./commands/acknowledge-handoff.js";
import { runBindWorkspace } from "./commands/bind-workspace.js";
import { runClaimFileOwnership } from "./commands/claim-file-ownership.js";
import { runCreateHandoff } from "./commands/create-handoff.js";
import { runLogin } from "./commands/login.js";
import { runStartAiTask } from "./commands/start-ai-task.js";
import { runViewReplay } from "./commands/view-replay.js";
import { runViewTimeline } from "./commands/view-timeline.js";
import { startActivityPublisher } from "./services/activity-publisher.js";
import { onRealtimeEvent, startRealtimeBridge } from "./services/realtime-client.js";
import { registerBranchlinePanels } from "./views/panel-views.js";

export function activate(context: vscode.ExtensionContext) {
  const panels = registerBranchlinePanels(context);
  const loginDisposable = vscode.commands.registerCommand("branchline.login", () => runLogin(context));
  const bindDisposable = vscode.commands.registerCommand("branchline.bindWorkspace", () =>
    runBindWorkspace(context)
  );
  const startTaskDisposable = vscode.commands.registerCommand("branchline.startAiTask", () =>
    runStartAiTask(context)
  );
  const createHandoffDisposable = vscode.commands.registerCommand("branchline.createHandoff", () =>
    runCreateHandoff(context)
  );
  const acknowledgeHandoffDisposable = vscode.commands.registerCommand("branchline.acknowledgeHandoff", (handoffId?: string) =>
    runAcknowledgeHandoff(context, handoffId)
  );
  const viewReplayDisposable = vscode.commands.registerCommand("branchline.viewReplay", () =>
    runViewReplay(context)
  );
  const viewTimelineDisposable = vscode.commands.registerCommand("branchline.viewTimeline", () =>
    runViewTimeline(context)
  );
  const claimOwnershipDisposable = vscode.commands.registerCommand("branchline.claimFileOwnership", () =>
    runClaimFileOwnership(context)
  );
  const realtimeDisposable = startRealtimeBridge(context);
  const activityDisposable = startActivityPublisher(context);
  const realtimeRefreshDisposable = onRealtimeEvent(() => {
    panels.refreshAll();
  });

  context.subscriptions.push(
    loginDisposable,
    bindDisposable,
    startTaskDisposable,
    createHandoffDisposable,
    acknowledgeHandoffDisposable,
    viewReplayDisposable,
    viewTimelineDisposable,
    claimOwnershipDisposable,
    realtimeDisposable,
    activityDisposable,
    realtimeRefreshDisposable
  );
}

export function deactivate() {
  // no-op
}
