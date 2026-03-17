import * as vscode from "vscode";

const INTENT_SEQUENCE_STATE_KEY = "branchline.intentSequenceByTask";

export async function nextIntentSequence(context: vscode.ExtensionContext, taskId: string): Promise<number> {
  const existing =
    context.workspaceState.get<Record<string, number>>(INTENT_SEQUENCE_STATE_KEY) ?? {};
  const next = (existing[taskId] ?? 0) + 1;

  await context.workspaceState.update(INTENT_SEQUENCE_STATE_KEY, {
    ...existing,
    [taskId]: next
  });

  return next;
}
