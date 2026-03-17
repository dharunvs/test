import * as vscode from "vscode";
import { io, type Socket } from "socket.io-client";

import { getValidAccessToken } from "../commands/login.js";
import { getWorkspaceBinding } from "./workspace-binding.js";

const API_BASE_URL = process.env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1";
type RealtimeEventPayload = {
  name:
    | "activity.user_state_changed"
    | "activity.file_focus_changed"
    | "conflict.detected"
    | "branch.status_changed"
    | "quality_gate.completed"
    | "handoff.created"
    | "pivot.mode_enabled";
  payload: unknown;
};
const realtimeEventEmitter = new vscode.EventEmitter<RealtimeEventPayload>();

export const onRealtimeEvent = realtimeEventEmitter.event;

function resolveSocketOrigin(): string {
  try {
    const parsed = new URL(API_BASE_URL);
    return parsed.origin;
  } catch {
    return "http://localhost:4000";
  }
}

export function startRealtimeBridge(context: vscode.ExtensionContext): vscode.Disposable {
  const output = vscode.window.createOutputChannel("Branchline Realtime");
  const seenEventIds = new Set<string>();
  let socket: Socket | null = null;
  let joinedProjectId: string | undefined;
  let joinedTaskId: string | undefined;

  const connectOrRefresh = async () => {
    const binding = getWorkspaceBinding(context);
    const token = await getValidAccessToken(context);

    if (!binding || !token) {
      return;
    }

    if (!socket) {
      socket = io(resolveSocketOrigin(), {
        auth: {
          token
        },
        transports: ["websocket"],
        reconnection: true
      });

      socket.io.on("reconnect_attempt", async () => {
        try {
          const refreshedToken = await getValidAccessToken(context);
          if (refreshedToken && socket) {
            socket.auth = {
              token: refreshedToken
            };
          }
        } catch {
          output.appendLine("[reconnect_attempt] failed_to_refresh_token");
        }
      });

      socket.on("connect", () => {
        output.appendLine(`[connected] socket=${socket?.id ?? "unknown"}`);
      });

      socket.on("disconnect", (reason) => {
        output.appendLine(`[disconnected] ${reason}`);
      });

      socket.on("activity.user_state_changed", (event: unknown) => {
        realtimeEventEmitter.fire({
          name: "activity.user_state_changed",
          payload: event
        });
      });

      socket.on("activity.file_focus_changed", (event: unknown) => {
        realtimeEventEmitter.fire({
          name: "activity.file_focus_changed",
          payload: event
        });
      });

      socket.on(
        "conflict.detected",
        (event: {
          eventId?: string;
          payload?: { severity?: string; suggestedAction?: string; filePaths?: string[] };
        }) => {
          const eventId = event.eventId;
          if (eventId && seenEventIds.has(eventId)) {
            return;
          }
          if (eventId) {
            seenEventIds.add(eventId);
          }
          realtimeEventEmitter.fire({
            name: "conflict.detected",
            payload: event
          });

          const severity = event.payload?.severity ?? "unknown";
          const action = event.payload?.suggestedAction ?? "review timeline";
          const firstFile = event.payload?.filePaths?.[0];
          const options = ["Claim ownership", "View timeline", "View replay"];
          if (firstFile) {
            options.push("Open impacted file");
          }

          void vscode.window
            .showWarningMessage(
              `Branchline conflict detected (${severity}). Suggested action: ${action}.`,
              ...options
            )
            .then(async (selection) => {
              if (selection === "Claim ownership") {
                await vscode.commands.executeCommand("branchline.claimFileOwnership");
                return;
              }
              if (selection === "View timeline") {
                await vscode.commands.executeCommand("branchline.viewTimeline");
                return;
              }
              if (selection === "View replay") {
                await vscode.commands.executeCommand("branchline.viewReplay");
                return;
              }
              if (selection === "Open impacted file" && firstFile) {
                const relative = firstFile.replace(/^\.?\//, "");
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                const file = workspaceFolder
                  ? vscode.Uri.joinPath(workspaceFolder.uri, relative)
                  : undefined;
                if (file) {
                  try {
                    const document = await vscode.workspace.openTextDocument(file);
                    await vscode.window.showTextDocument(document, {
                      preview: false
                    });
                  } catch {
                    void vscode.window.showWarningMessage(
                      `Unable to open impacted file from conflict payload: ${firstFile}`
                    );
                  }
                }
              }
            });
        }
      );

      socket.on("quality_gate.completed", (event: { eventId?: string; payload?: { status?: string } }) => {
        const eventId = event.eventId;
        if (eventId && seenEventIds.has(eventId)) {
          return;
        }
        if (eventId) {
          seenEventIds.add(eventId);
        }
        realtimeEventEmitter.fire({
          name: "quality_gate.completed",
          payload: event
        });

        void vscode.window.showInformationMessage(`Branchline quality gate completed with status: ${event.payload?.status ?? "unknown"}.`);
      });

      socket.on(
        "branch.status_changed",
        (event: { eventId?: string; payload?: { status?: string; pullRequestNumber?: number } }) => {
          const eventId = event.eventId;
          if (eventId && seenEventIds.has(eventId)) {
            return;
          }
          if (eventId) {
            seenEventIds.add(eventId);
          }
          realtimeEventEmitter.fire({
            name: "branch.status_changed",
            payload: event
          });

          const status = event.payload?.status ?? "unknown";
          const pr = event.payload?.pullRequestNumber ? ` PR #${event.payload.pullRequestNumber}` : "";
          void vscode.window.showInformationMessage(`Branchline branch status changed: ${status}.${pr}`);
        }
      );

      socket.on("handoff.created", (event: { eventId?: string; payload?: { summary?: string } }) => {
        const eventId = event.eventId;
        if (eventId && seenEventIds.has(eventId)) {
          return;
        }
        if (eventId) {
          seenEventIds.add(eventId);
        }
        realtimeEventEmitter.fire({
          name: "handoff.created",
          payload: event
        });

        if (event.payload?.summary) {
          void vscode.window.showInformationMessage(`Branchline handoff created: ${event.payload.summary}`);
        }
      });

      socket.on("pivot.mode_enabled", (event: { eventId?: string; payload?: { title?: string } }) => {
        const eventId = event.eventId;
        if (eventId && seenEventIds.has(eventId)) {
          return;
        }
        if (eventId) {
          seenEventIds.add(eventId);
        }
        realtimeEventEmitter.fire({
          name: "pivot.mode_enabled",
          payload: event
        });
        void vscode.window.showInformationMessage(
          `Branchline pivot mode enabled${event.payload?.title ? `: ${event.payload.title}` : ""}.`
        );
      });
    }

    if (joinedProjectId !== binding.projectId) {
      if (joinedProjectId) {
        socket.emit("leave_project", {
          projectId: joinedProjectId
        });
      }

      socket.emit("join_project", {
        projectId: binding.projectId
      });
      joinedProjectId = binding.projectId;
      output.appendLine(`[join_project] ${binding.projectId}`);
    }

    const activeTaskId = context.workspaceState.get<string>("branchline.currentTaskId");
    if (joinedTaskId !== activeTaskId) {
      if (joinedTaskId) {
        socket.emit("leave_task", {
          taskId: joinedTaskId
        });
      }

      if (activeTaskId) {
        socket.emit("join_task", {
          taskId: activeTaskId
        });
        output.appendLine(`[join_task] ${activeTaskId}`);
      }
      joinedTaskId = activeTaskId;
    }
  };

  const timer = setInterval(() => {
    void connectOrRefresh();
  }, 10000);

  void connectOrRefresh();

  return new vscode.Disposable(() => {
    clearInterval(timer);
    if (socket && joinedTaskId) {
      socket.emit("leave_task", {
        taskId: joinedTaskId
      });
    }
    socket?.disconnect();
    output.dispose();
  });
}
