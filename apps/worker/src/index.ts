import { Queue, Worker } from "bullmq";

import { readWorkerEnv } from "./env.js";
import {
  processAnalyticsRollup,
  processConflictScore,
  processGuardrailEvaluate,
  processHandoffGenerate,
  processIntentNormalize,
  processNotificationsDispatch,
  processPrSlice,
  processQualityRun
} from "./processors/processors.js";

const env = readWorkerEnv();
const redisUrl = env.redisUrl;
const connection = { url: redisUrl };
const deadLetterQueue = new Queue("queue.dead_letter", {
  connection
});

const workers = [
  new Worker("queue.intent.normalize", processIntentNormalize, { connection }),
  new Worker("queue.conflict.score", processConflictScore, { connection }),
  new Worker("queue.guardrail.evaluate", processGuardrailEvaluate, { connection }),
  new Worker("queue.quality.run", processQualityRun, { connection }),
  new Worker("queue.pr.slice", processPrSlice, { connection }),
  new Worker("queue.handoff.generate", processHandoffGenerate, { connection }),
  new Worker("queue.notifications.dispatch", processNotificationsDispatch, { connection }),
  new Worker("queue.analytics.rollup", processAnalyticsRollup, { connection })
];

for (const worker of workers) {
  worker.on("failed", (job, error) => {
    console.error(`[worker:${worker.name}] job failed`, job?.id, error.message);

    if (!job) {
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      void deadLetterQueue
        .add(
          "dead-letter",
          {
            queueName: worker.name,
            originalJobId: job.id,
            attemptsMade: job.attemptsMade,
            maxAttempts,
            failedReason: error.message,
            data: job.data,
            timestamp: new Date().toISOString()
          },
          {
            removeOnComplete: 2000,
            removeOnFail: 2000
          }
        )
        .catch((dlqError) => {
          console.error(`[worker:${worker.name}] failed to enqueue dead letter`, dlqError);
        });
    }
  });

  worker.on("completed", (job) => {
    console.log(`[worker:${worker.name}] completed`, job.id);
  });
}

console.log("Branchline workers started", { queues: workers.map((w) => w.name) });
