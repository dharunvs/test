import { randomUUID } from "node:crypto";

import type { EventEnvelope } from "@branchline/shared-events";

export function buildIntentEvent(input: {
  orgId: string;
  projectId: string;
  repositoryId: string;
  taskId: string;
  branchId?: string;
  userId?: string;
  type: string;
  payload: Record<string, unknown>;
  sequence?: number;
}): EventEnvelope {
  return {
    eventId: randomUUID(),
    orgId: input.orgId,
    projectId: input.projectId,
    source: "extension",
    type: input.type,
    timestamp: new Date().toISOString(),
    actor: {
      userId: input.userId,
      clientId: undefined
    },
    context: {
      taskId: input.taskId,
      branchId: input.branchId,
      repositoryId: input.repositoryId
    },
    sequence: input.sequence,
    payload: input.payload
  };
}
