import * as vscode from "vscode";

import { getValidAccessToken } from "../commands/login.js";
import { ApiClient } from "../services/api-client.js";
import { getWorkspaceBinding } from "../services/workspace-binding.js";

const API_BASE_URL = process.env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1";
const TIMELINE_FILTER_STATE_KEY = "branchline.timelineCategoryFilter";
const DISMISSED_CONFLICTS_STATE_KEY = "branchline.dismissedConflicts";
const REPLAY_POSITION_STATE_KEY = "branchline.replayReadPosition";

type ConflictDismissState = Record<string, string[]>;
type ReplayPositionState = Record<string, number>;
type TimelineFilter = "all" | "intent" | "decision" | "activity" | "quality" | "conflict" | "handoff" | "branch";

type BranchlinePanelControllers = {
  timeline: BasePanelProvider;
  activity: BasePanelProvider;
  conflicts: BasePanelProvider;
  handoffs: BasePanelProvider;
  replay: BasePanelProvider;
  refreshAll: () => void;
};

class PanelTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    options?: {
      description?: string;
      tooltip?: string;
      collapsibleState?: vscode.TreeItemCollapsibleState;
      iconPath?: vscode.ThemeIcon;
      contextValue?: string;
      command?: vscode.Command;
      children?: PanelTreeItem[];
    }
  ) {
    super(label, options?.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    this.description = options?.description;
    this.tooltip = options?.tooltip;
    this.iconPath = options?.iconPath;
    this.contextValue = options?.contextValue;
    this.command = options?.command;
    this.children = options?.children;
  }

  readonly children?: PanelTreeItem[];
}

abstract class BasePanelProvider implements vscode.TreeDataProvider<PanelTreeItem> {
  private readonly emitter = new vscode.EventEmitter<PanelTreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(protected readonly context: vscode.ExtensionContext) {}

  getTreeItem(element: PanelTreeItem): vscode.TreeItem {
    return element;
  }

  refresh() {
    this.emitter.fire(undefined);
  }

  async getChildren(element?: PanelTreeItem): Promise<PanelTreeItem[]> {
    if (element?.children) {
      return element.children;
    }
    return this.loadRootItems();
  }

  protected abstract loadRootItems(): Promise<PanelTreeItem[]>;

  protected async getApiClient(): Promise<ApiClient | undefined> {
    const token = await getValidAccessToken(this.context);
    if (!token) {
      return undefined;
    }

    return new ApiClient(API_BASE_URL, token);
  }

  protected getCurrentTaskId() {
    return this.context.workspaceState.get<string>("branchline.currentTaskId");
  }

  protected getCurrentBranchId() {
    return this.context.workspaceState.get<string>("branchline.currentBranchId");
  }

  protected getBinding() {
    return getWorkspaceBinding(this.context);
  }

  protected renderAuthRequired(message: string) {
    return [
      new PanelTreeItem(message, {
        iconPath: new vscode.ThemeIcon("warning")
      })
    ];
  }

  protected renderEmpty(message: string) {
    return [
      new PanelTreeItem(message, {
        iconPath: new vscode.ThemeIcon("circle-slash")
      })
    ];
  }

  protected renderError(message: string) {
    return [
      new PanelTreeItem(message, {
        iconPath: new vscode.ThemeIcon("error")
      })
    ];
  }
}

class TimelineProvider extends BasePanelProvider {
  protected async loadRootItems(): Promise<PanelTreeItem[]> {
    const taskId = this.getCurrentTaskId();
    if (!taskId) {
      return this.renderEmpty("No active task. Run 'Branchline: Start AI Task'.");
    }

    const api = await this.getApiClient();
    if (!api) {
      return this.renderAuthRequired("Sign in to load timeline.");
    }

    try {
      const filter = this.context.workspaceState.get<TimelineFilter>(TIMELINE_FILTER_STATE_KEY) ?? "all";
      const timeline = await api.fetchTaskTimeline(taskId);

      const filteredEvents =
        filter === "all"
          ? timeline.timeline
          : timeline.timeline.filter((entry) => entry.category === filter);

      return [
        new PanelTreeItem(`Filter: ${filter}`, {
          iconPath: new vscode.ThemeIcon("filter"),
          command: {
            command: "branchline.timeline.setFilter",
            title: "Set timeline filter"
          }
        }),
        ...(filteredEvents.length > 0
          ? filteredEvents.map(
              (entry) =>
                new PanelTreeItem(`${entry.category} - ${entry.type}`, {
                  description: new Date(entry.timestamp).toLocaleTimeString(),
                  tooltip: `${entry.type}\n${new Date(entry.timestamp).toLocaleString()}\n${entry.id}`,
                  iconPath: new vscode.ThemeIcon("history"),
                  command: {
                    command: "branchline.viewTimeline",
                    title: "Open timeline"
                  }
                })
            )
          : this.renderEmpty("No timeline events for the selected filter."))
      ];
    } catch (error) {
      return this.renderError(
        `Timeline load failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }
}

class LiveActivityProvider extends BasePanelProvider {
  protected async loadRootItems(): Promise<PanelTreeItem[]> {
    const binding = this.getBinding();
    if (!binding) {
      return this.renderEmpty("Bind workspace to view live activity.");
    }

    const api = await this.getApiClient();
    if (!api) {
      return this.renderAuthRequired("Sign in to load activity.");
    }

    try {
      const rows = await api.fetchPresence(binding.projectId);
      if (rows.length === 0) {
        return this.renderEmpty("No active collaborators in this project.");
      }

      const now = Date.now();
      return rows.map((row) => {
        const ageSeconds = Math.max(0, Math.floor((now - new Date(row.lastSeenAt).getTime()) / 1000));
        const stale = ageSeconds > 60;
        return new PanelTreeItem(row.userId, {
          description: `${row.state}${stale ? " (stale)" : ""}`,
          tooltip: `${row.activeFilePath ?? "No active file"}\nLast seen ${ageSeconds}s ago`,
          iconPath: new vscode.ThemeIcon(stale ? "clock" : "account"),
          children: [
            new PanelTreeItem(`File: ${row.activeFilePath ?? "(none)"}`, {
              iconPath: new vscode.ThemeIcon("file")
            }),
            new PanelTreeItem("Claim ownership for active file", {
              iconPath: new vscode.ThemeIcon("lock"),
              command: {
                command: "branchline.claimFileOwnership",
                title: "Claim file ownership"
              }
            })
          ],
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
        });
      });
    } catch (error) {
      return this.renderError(
        `Activity load failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }
}

class ConflictCenterProvider extends BasePanelProvider {
  protected async loadRootItems(): Promise<PanelTreeItem[]> {
    const taskId = this.getCurrentTaskId();
    if (!taskId) {
      return this.renderEmpty("No active task. Start a task to monitor conflicts.");
    }

    const api = await this.getApiClient();
    if (!api) {
      return this.renderAuthRequired("Sign in to load conflicts.");
    }

    const dismissedState =
      this.context.workspaceState.get<ConflictDismissState>(DISMISSED_CONFLICTS_STATE_KEY) ?? {};
    const dismissed = new Set(dismissedState[taskId] ?? []);

    try {
      const conflicts = await api.fetchTaskConflicts(taskId);
      const visibleConflicts = conflicts.filter((conflict) => !dismissed.has(conflict.id));

      if (visibleConflicts.length === 0) {
        return this.renderEmpty("No active conflicts.");
      }

      return visibleConflicts.map((conflict) => {
        const firstFile = conflict.filePaths[0];
        const severity = conflict.severity.toUpperCase();
        return new PanelTreeItem(`${severity} (${conflict.score})`, {
          description: `${conflict.filePaths.length} files`,
          tooltip: `${conflict.symbolNames.join(", ") || "No symbol overlap"}`,
          iconPath: new vscode.ThemeIcon(conflict.score >= 80 ? "warning" : "alert"),
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          children: [
            new PanelTreeItem("Split work recommendation", {
              iconPath: new vscode.ThemeIcon("split-horizontal"),
              command: {
                command: "branchline.viewTimeline",
                title: "View timeline"
              }
            }),
            new PanelTreeItem("Claim ownership", {
              iconPath: new vscode.ThemeIcon("lock"),
              command: {
                command: "branchline.claimFileOwnership",
                title: "Claim ownership"
              }
            }),
            new PanelTreeItem("Rebase hint: sync with latest base branch", {
              iconPath: new vscode.ThemeIcon("git-pull-request")
            }),
            ...(firstFile
              ? [
                  new PanelTreeItem(`Open impacted file: ${firstFile}`, {
                    iconPath: new vscode.ThemeIcon("file"),
                    command: {
                      command: "branchline.conflicts.openFile",
                      title: "Open impacted file",
                      arguments: [firstFile]
                    }
                  })
                ]
              : []),
            new PanelTreeItem("Dismiss conflict", {
              iconPath: new vscode.ThemeIcon("eye-closed"),
              command: {
                command: "branchline.conflicts.dismiss",
                title: "Dismiss conflict",
                arguments: [taskId, conflict.id]
              }
            })
          ]
        });
      });
    } catch (error) {
      return this.renderError(
        `Conflict load failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }
}

class HandoffsProvider extends BasePanelProvider {
  protected async loadRootItems(): Promise<PanelTreeItem[]> {
    const taskId = this.getCurrentTaskId();
    if (!taskId) {
      return this.renderEmpty("No active task. Start a task to view handoffs.");
    }

    const api = await this.getApiClient();
    if (!api) {
      return this.renderAuthRequired("Sign in to load handoffs.");
    }

    try {
      const handoffs = await api.fetchTaskHandoffs(taskId);
      return [
        new PanelTreeItem("Generate handoff", {
          iconPath: new vscode.ThemeIcon("diff-added"),
          command: {
            command: "branchline.createHandoff",
            title: "Create handoff"
          }
        }),
        ...(handoffs.length > 0
          ? handoffs.map((handoff) => {
              const ackCount = handoff.acks.length;
              return new PanelTreeItem(handoff.summary, {
                description: `${ackCount} ack${ackCount === 1 ? "" : "s"}`,
                tooltip: `${new Date(handoff.createdAt).toLocaleString()}`,
                iconPath: new vscode.ThemeIcon("inbox"),
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                children: [
                  new PanelTreeItem("Acknowledge handoff", {
                    iconPath: new vscode.ThemeIcon("check"),
                    command: {
                      command: "branchline.acknowledgeHandoff",
                      title: "Acknowledge handoff",
                      arguments: [handoff.id]
                    }
                  }),
                  new PanelTreeItem("Resume with replay", {
                    iconPath: new vscode.ThemeIcon("history"),
                    command: {
                      command: "branchline.viewReplay",
                      title: "View replay"
                    }
                  })
                ]
              });
            })
          : this.renderEmpty("No handoffs for this task yet."))
      ];
    } catch (error) {
      return this.renderError(
        `Handoff load failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }
}

class ReplayProvider extends BasePanelProvider {
  protected async loadRootItems(): Promise<PanelTreeItem[]> {
    const taskId = this.getCurrentTaskId();
    if (!taskId) {
      return this.renderEmpty("No active task. Start a task to view replay.");
    }

    const api = await this.getApiClient();
    if (!api) {
      return this.renderAuthRequired("Sign in to load replay.");
    }

    try {
      const replay = await api.fetchReplay(taskId);
      const replayPositionState =
        this.context.workspaceState.get<ReplayPositionState>(REPLAY_POSITION_STATE_KEY) ?? {};
      const readPosition = replayPositionState[taskId] ?? -1;
      const branchId = this.getCurrentBranchId();

      const items: PanelTreeItem[] = [
        new PanelTreeItem(`Snapshot v${replay.snapshotVersion}`, {
          description: new Date(replay.generatedAt).toLocaleString(),
          iconPath: new vscode.ThemeIcon("history")
        }),
        new PanelTreeItem("Export replay", {
          iconPath: new vscode.ThemeIcon("export"),
          command: {
            command: "branchline.viewReplay",
            title: "View replay export"
          }
        })
      ];

      if (branchId) {
        const automation = await api.fetchBranchAutomationStatus(branchId);
        items.push(
          new PanelTreeItem(`Branch: ${automation.branchName}`, {
            description: automation.blockingReasons.length > 0 ? "merge blocked" : "merge-ready",
            tooltip: automation.blockingReasons.join(", ") || "No blockers",
            iconPath: new vscode.ThemeIcon(
              automation.blockingReasons.length > 0 ? "error" : "pass"
            )
          })
        );
      }

      if (replay.steps.length === 0) {
        items.push(...this.renderEmpty("Replay has no recorded steps yet."));
        return items;
      }

      items.push(
        ...replay.steps.map((step, index) => {
          const completed = index <= readPosition;
          return new PanelTreeItem(`${index + 1}. ${step}`, {
            iconPath: new vscode.ThemeIcon(completed ? "check" : "circle-outline"),
            command: {
              command: "branchline.replay.markPosition",
              title: "Mark replay position",
              arguments: [taskId, index]
            }
          });
        })
      );

      return items;
    } catch (error) {
      return this.renderError(
        `Replay load failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }
}

async function openWorkspaceRelativeFile(filePath: string) {
  const relative = filePath.replace(/^\.?\//, "");
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  const file = vscode.Uri.joinPath(workspaceFolder.uri, relative);
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document, {
    preview: false
  });
}

async function setTimelineFilter(context: vscode.ExtensionContext) {
  const selection = await vscode.window.showQuickPick(
    [
      { label: "All", value: "all" },
      { label: "Intent", value: "intent" },
      { label: "Decision", value: "decision" },
      { label: "Activity", value: "activity" },
      { label: "Quality", value: "quality" },
      { label: "Conflict", value: "conflict" },
      { label: "Handoff", value: "handoff" },
      { label: "Branch", value: "branch" }
    ],
    {
      title: "Timeline filter"
    }
  );

  if (!selection) {
    return;
  }

  await context.workspaceState.update(TIMELINE_FILTER_STATE_KEY, selection.value as TimelineFilter);
}

async function dismissConflict(context: vscode.ExtensionContext, taskId: string, conflictId: string) {
  const state = context.workspaceState.get<ConflictDismissState>(DISMISSED_CONFLICTS_STATE_KEY) ?? {};
  const current = new Set(state[taskId] ?? []);
  current.add(conflictId);
  await context.workspaceState.update(DISMISSED_CONFLICTS_STATE_KEY, {
    ...state,
    [taskId]: Array.from(current)
  });
}

async function markReplayPosition(context: vscode.ExtensionContext, taskId: string, index: number) {
  const state = context.workspaceState.get<ReplayPositionState>(REPLAY_POSITION_STATE_KEY) ?? {};
  await context.workspaceState.update(REPLAY_POSITION_STATE_KEY, {
    ...state,
    [taskId]: index
  });
}

export function registerBranchlinePanels(context: vscode.ExtensionContext): BranchlinePanelControllers {
  const timeline = new TimelineProvider(context);
  const activity = new LiveActivityProvider(context);
  const conflicts = new ConflictCenterProvider(context);
  const handoffs = new HandoffsProvider(context);
  const replay = new ReplayProvider(context);

  const refreshAll = () => {
    timeline.refresh();
    activity.refresh();
    conflicts.refresh();
    handoffs.refresh();
    replay.refresh();
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("branchline.timelineView", timeline),
    vscode.window.registerTreeDataProvider("branchline.activityView", activity),
    vscode.window.registerTreeDataProvider("branchline.conflictsView", conflicts),
    vscode.window.registerTreeDataProvider("branchline.handoffsView", handoffs),
    vscode.window.registerTreeDataProvider("branchline.replayView", replay),
    vscode.commands.registerCommand("branchline.timeline.refresh", () => timeline.refresh()),
    vscode.commands.registerCommand("branchline.activity.refresh", () => activity.refresh()),
    vscode.commands.registerCommand("branchline.conflicts.refresh", () => conflicts.refresh()),
    vscode.commands.registerCommand("branchline.handoffs.refresh", () => handoffs.refresh()),
    vscode.commands.registerCommand("branchline.replay.refresh", () => replay.refresh()),
    vscode.commands.registerCommand("branchline.timeline.setFilter", () =>
      setTimelineFilter(context).then(() => timeline.refresh())
    ),
    vscode.commands.registerCommand("branchline.conflicts.dismiss", (taskId: string, conflictId: string) =>
      dismissConflict(context, taskId, conflictId).then(() => conflicts.refresh())
    ),
    vscode.commands.registerCommand("branchline.conflicts.openFile", (filePath: string) =>
      openWorkspaceRelativeFile(filePath)
    ),
    vscode.commands.registerCommand("branchline.replay.markPosition", (taskId: string, index: number) =>
      markReplayPosition(context, taskId, index).then(() => replay.refresh())
    )
  );

  return {
    timeline,
    activity,
    conflicts,
    handoffs,
    replay,
    refreshAll
  };
}

