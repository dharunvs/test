import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  ServiceUnavailableException
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { z } from "zod";

import { getMetricsRegistry } from "../../common/metrics.js";
import { PrismaService } from "../../common/prisma.service.js";
import { reliableQueueOptions } from "../../common/queue-options.js";
import { Public } from "../auth/public.decorator.js";
import { Roles } from "../auth/roles.decorator.js";

const replayDeadLetterSchema = z.object({
  queueName: z.string().optional(),
  limit: z.number().int().positive().max(200).default(100)
});

const realtimeLatencyQuerySchema = z.object({
  projectId: z.string().uuid(),
  windowMinutes: z.coerce.number().int().positive().max(24 * 60).default(60)
});

@Controller("observability")
export class ObservabilityController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("queue.intent.normalize") private readonly intentQueue: Queue,
    @InjectQueue("queue.conflict.score") private readonly conflictQueue: Queue,
    @InjectQueue("queue.guardrail.evaluate") private readonly guardrailQueue: Queue,
    @InjectQueue("queue.quality.run") private readonly qualityQueue: Queue,
    @InjectQueue("queue.pr.slice") private readonly prSliceQueue: Queue,
    @InjectQueue("queue.handoff.generate") private readonly handoffQueue: Queue,
    @InjectQueue("queue.notifications.dispatch") private readonly notificationQueue: Queue,
    @InjectQueue("queue.analytics.rollup") private readonly analyticsQueue: Queue,
    @InjectQueue("queue.dead_letter") private readonly deadLetterQueue: Queue
  ) {}

  @Public()
  @Get("readiness")
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "database_unavailable";
      throw new ServiceUnavailableException(`readiness_failed:${message}`);
    }

    return {
      status: "ok",
      generatedAt: new Date().toISOString()
    };
  }

  @Roles("owner", "admin")
  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4")
  async metrics() {
    return getMetricsRegistry().metrics();
  }

  @Roles("owner", "admin")
  @Get("queues")
  async queueDepth() {
    const queues = [
      this.intentQueue,
      this.conflictQueue,
      this.guardrailQueue,
      this.qualityQueue,
      this.prSliceQueue,
      this.handoffQueue,
      this.notificationQueue,
      this.analyticsQueue,
      this.deadLetterQueue
    ];

    const counts = await Promise.all(
      queues.map(async (queue) => ({
        name: queue.name,
        ...(await queue.getJobCounts(
          "active",
          "completed",
          "delayed",
          "failed",
          "paused",
          "prioritized",
          "waiting",
          "waiting-children"
        ))
      }))
    );

    return {
      at: new Date().toISOString(),
      queues: counts
    };
  }

  @Roles("owner", "admin")
  @Post("queues/dead-letter/replay")
  async replayDeadLetters(@Body() body: unknown) {
    const input = replayDeadLetterSchema.parse(body ?? {});
    const jobs = await this.deadLetterQueue.getJobs(["waiting", "delayed", "failed"], 0, input.limit - 1);
    const queueMap = new Map<string, Queue>([
      [this.intentQueue.name, this.intentQueue],
      [this.conflictQueue.name, this.conflictQueue],
      [this.guardrailQueue.name, this.guardrailQueue],
      [this.qualityQueue.name, this.qualityQueue],
      [this.prSliceQueue.name, this.prSliceQueue],
      [this.handoffQueue.name, this.handoffQueue],
      [this.notificationQueue.name, this.notificationQueue],
      [this.analyticsQueue.name, this.analyticsQueue]
    ]);

    let replayed = 0;
    let skipped = 0;

    for (const job of jobs) {
      const payload = job.data as {
        queueName?: string;
        data?: unknown;
      };
      const targetQueueName = payload.queueName;

      if (!targetQueueName) {
        skipped += 1;
        continue;
      }
      if (input.queueName && targetQueueName !== input.queueName) {
        skipped += 1;
        continue;
      }

      const targetQueue = queueMap.get(targetQueueName);
      if (!targetQueue) {
        skipped += 1;
        continue;
      }

      await targetQueue.add("replayed", payload.data ?? {}, reliableQueueOptions);
      await job.remove();
      replayed += 1;
    }

    return {
      scanned: jobs.length,
      replayed,
      skipped
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get("realtime-latency")
  async realtimeLatency(@Query() query: Record<string, unknown>) {
    const input = realtimeLatencyQuerySchema.parse(query);
    const windowStartedAt = new Date(Date.now() - input.windowMinutes * 60_000);
    const events = await this.prisma.activityEvent.findMany({
      where: {
        projectId: input.projectId,
        occurredAt: {
          gte: windowStartedAt
        }
      },
      select: {
        occurredAt: true,
        createdAt: true
      },
      orderBy: {
        occurredAt: "asc"
      }
    });

    const latencies = events
      .map((event) => Math.max(event.createdAt.getTime() - event.occurredAt.getTime(), 0))
      .sort((left, right) => left - right);

    const percentile = (values: number[], value: number) => {
      if (values.length === 0) {
        return 0;
      }
      const index = Math.max(0, Math.min(values.length - 1, Math.ceil((value / 100) * values.length) - 1));
      return values[index];
    };

    const p50Ms = percentile(latencies, 50) ?? 0;
    const p95Ms = percentile(latencies, 95) ?? 0;
    const maxMs = latencies[latencies.length - 1] ?? 0;
    const targetP95Ms = 2_000;

    return {
      projectId: input.projectId,
      windowMinutes: input.windowMinutes,
      sampleCount: latencies.length,
      p50Ms,
      p95Ms,
      maxMs,
      targetP95Ms,
      withinTarget: p95Ms <= targetP95Ms,
      generatedAt: new Date().toISOString()
    };
  }
}
