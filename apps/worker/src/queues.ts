import type { QueueTopic } from "@branchline/shared-events";

export const queueTopics: QueueTopic[] = [
  "queue.intent.normalize",
  "queue.conflict.score",
  "queue.guardrail.evaluate",
  "queue.quality.run",
  "queue.pr.slice",
  "queue.handoff.generate",
  "queue.notifications.dispatch",
  "queue.analytics.rollup"
];
