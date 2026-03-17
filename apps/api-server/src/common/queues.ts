import type { QueueTopic } from "@branchline/shared-events";

export const QUEUES: Record<string, QueueTopic> = {
  intentNormalize: "queue.intent.normalize",
  conflictScore: "queue.conflict.score",
  guardrailEvaluate: "queue.guardrail.evaluate",
  qualityRun: "queue.quality.run",
  prSlice: "queue.pr.slice",
  handoffGenerate: "queue.handoff.generate",
  notificationsDispatch: "queue.notifications.dispatch",
  analyticsRollup: "queue.analytics.rollup"
};
