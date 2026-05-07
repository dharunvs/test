import type { QueueTopic } from "@branchline/shared-events";

export const QUEUES: Record<string, QueueTopic> = {
  intentNormalize: "queue.intent.normalize"
};
