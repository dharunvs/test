import * as vscode from "vscode";

import { ApiClient } from "./api-client.js";

const PENDING_INTENT_CAPTURES_STATE_KEY = "branchline.pendingIntentCaptures";

export interface PendingIntentCapture {
  taskId: string;
  prompt: string;
  summary: string;
  files: string[];
  commitId: string;
  queuedAt: string;
}

function sanitizeCapture(input: PendingIntentCapture): PendingIntentCapture {
  return {
    taskId: input.taskId,
    prompt: input.prompt.trim(),
    summary: input.summary.trim(),
    files: Array.from(new Set(input.files.map((file) => file.trim()).filter((file) => file.length > 0))).slice(0, 200),
    commitId: input.commitId.trim(),
    queuedAt: input.queuedAt
  };
}

export async function enqueueIntentCapture(context: vscode.ExtensionContext, capture: PendingIntentCapture) {
  const existing = context.workspaceState.get<PendingIntentCapture[]>(PENDING_INTENT_CAPTURES_STATE_KEY) ?? [];
  const next = [...existing, sanitizeCapture(capture)];
  await context.workspaceState.update(PENDING_INTENT_CAPTURES_STATE_KEY, next.slice(-100));
}

export async function flushPendingIntentCaptures(context: vscode.ExtensionContext, api: ApiClient) {
  const existing = context.workspaceState.get<PendingIntentCapture[]>(PENDING_INTENT_CAPTURES_STATE_KEY) ?? [];
  if (existing.length === 0) {
    return {
      flushed: 0,
      remaining: 0
    };
  }

  let flushed = 0;
  const remaining: PendingIntentCapture[] = [];

  for (const capture of existing) {
    try {
      await api.captureIntent({
        taskId: capture.taskId,
        prompt: capture.prompt,
        summary: capture.summary,
        files: capture.files,
        commitId: capture.commitId
      });
      flushed += 1;
    } catch {
      remaining.push(capture);
    }
  }

  await context.workspaceState.update(PENDING_INTENT_CAPTURES_STATE_KEY, remaining);
  return {
    flushed,
    remaining: remaining.length
  };
}

