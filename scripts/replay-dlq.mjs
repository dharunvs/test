#!/usr/bin/env node
import { Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const limit = Number(process.env.DLQ_LIMIT ?? "100");
const queueFilter = process.env.DLQ_QUEUE_NAME;

const connection = {
  url: redisUrl
};

const knownQueues = [
  "queue.intent.normalize",
  "queue.conflict.score",
  "queue.guardrail.evaluate",
  "queue.quality.run",
  "queue.pr.slice",
  "queue.handoff.generate",
  "queue.notifications.dispatch",
  "queue.analytics.rollup"
];

const deadLetterQueue = new Queue("queue.dead_letter", {
  connection
});
const targets = new Map(
  knownQueues.map((name) => [
    name,
    new Queue(name, {
      connection
    })
  ])
);

const jobs = await deadLetterQueue.getJobs(["waiting", "delayed", "failed"], 0, Math.max(0, limit - 1));
let replayed = 0;
let skipped = 0;

for (const job of jobs) {
  const payload = job.data ?? {};
  const queueName = typeof payload.queueName === "string" ? payload.queueName : undefined;
  if (!queueName) {
    skipped += 1;
    continue;
  }
  if (queueFilter && queueName !== queueFilter) {
    skipped += 1;
    continue;
  }
  const target = targets.get(queueName);
  if (!target) {
    skipped += 1;
    continue;
  }

  await target.add("replayed", payload.data ?? {}, {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2000
    },
    removeOnComplete: 1000,
    removeOnFail: 5000
  });
  await job.remove();
  replayed += 1;
}

await deadLetterQueue.close();
for (const target of targets.values()) {
  await target.close();
}

console.log(
  JSON.stringify(
    {
      redisUrl,
      scanned: jobs.length,
      replayed,
      skipped,
      queueFilter: queueFilter ?? null
    },
    null,
    2
  )
);

