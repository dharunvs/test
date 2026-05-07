import type { Job } from "bullmq";
import { PrismaClient } from "@prisma/client";

import { readWorkerEnv } from "../env.js";

readWorkerEnv();

const prisma = new PrismaClient();

export async function processIntentNormalize(job: Job) {
  const payload = (job.data ?? {}) as {
    eventId?: string;
    taskId?: string;
    projectId?: string;
    orgId?: string;
  };

  if (!payload.taskId) {
    return {
      jobId: job.id,
      normalized: false,
      reason: "taskId_missing"
    };
  }

  const intentEvent = payload.eventId
    ? await prisma.intentEvent.findUnique({
        where: {
          id: payload.eventId
        }
      })
    : null;

  await prisma.taskDecision
    .create({
      data: {
        orgId: payload.orgId ?? intentEvent?.orgId ?? "00000000-0000-0000-0000-000000000001",
        projectId: payload.projectId ?? intentEvent?.projectId ?? "00000000-0000-0000-0000-000000000001",
        taskId: payload.taskId,
        decisionType: "intent_normalized",
        summary: `Intent event ${payload.eventId ?? "unknown"} normalized`,
        rationale: JSON.stringify({
          eventId: payload.eventId,
          eventType: intentEvent?.eventType
        })
      }
    })
    .catch(() => {
      // Task may have been deleted or event reprocessed.
    });

  return {
    jobId: job.id,
    normalized: true,
    receivedAt: new Date().toISOString()
  };
}

