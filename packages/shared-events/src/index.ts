import { z } from "zod";

export const socketEventNames = [
  "activity.user_state_changed",
  "activity.file_focus_changed",
  "conflict.detected",
  "branch.status_changed",
  "quality_gate.completed",
  "handoff.created",
  "pivot.mode_enabled"
] as const;

export type SocketEventName = (typeof socketEventNames)[number];

export const queueTopics = [
  "queue.intent.normalize",
  "queue.conflict.score",
  "queue.guardrail.evaluate",
  "queue.quality.run",
  "queue.pr.slice",
  "queue.handoff.generate",
  "queue.notifications.dispatch",
  "queue.analytics.rollup"
] as const;

export type QueueTopic = (typeof queueTopics)[number];

export const eventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  source: z.enum(["extension", "web_console", "worker", "webhook"]),
  type: z.string().min(1),
  timestamp: z.string().datetime(),
  actor: z.object({
    userId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional()
  }),
  context: z.object({
    taskId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    repositoryId: z.string().uuid().optional()
  }),
  sequence: z.number().int().nonnegative().optional(),
  payload: z.record(z.unknown())
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
