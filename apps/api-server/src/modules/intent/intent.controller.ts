import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { eventEnvelopeSchema } from "@branchline/shared-events";
import { Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import { z } from "zod";

import { toJson } from "../../common/json.js";
import { PrismaService } from "../../common/prisma.service.js";
import { reliableQueueOptions } from "../../common/queue-options.js";
import { applyRedactionPolicy, resolveRedactionPolicy } from "../../common/redaction.js";
import { Roles } from "../auth/roles.decorator.js";

const timelineQuerySchema = z.object({
  taskId: z.string().uuid(),
  limit: z.coerce.number().int().positive().max(500).default(200),
  includeRelated: z.coerce.boolean().default(false)
});

const commitMetadataSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  runId: z.string().uuid(),
  intentId: z.string().uuid(),
  commitSha: z.string().min(7),
  provider: z.string().default("extension"),
  model: z.string().default("local"),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional()
});

@Controller("intent")
export class IntentController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("queue.intent.normalize") private readonly intentNormalizeQueue: Queue,
    @InjectQueue("queue.analytics.rollup") private readonly analyticsQueue: Queue
  ) {}

  @Roles("owner", "admin", "member")
  @Post("events")
  async ingest(@Body() body: unknown) {
    const envelope = eventEnvelopeSchema.parse(body);

    if (!envelope.context.taskId) {
      throw new BadRequestException("context.taskId is required for intent events");
    }

    const taskId = envelope.context.taskId;
    const branchId = envelope.context.branchId;

    const existing = await this.prisma.intentEvent.findUnique({
      where: {
        id: envelope.eventId
      }
    });

    if (existing) {
      return {
        accepted: true,
        eventId: envelope.eventId,
        sequence: Number(existing.eventSeq),
        idempotent: true
      };
    }

    const redactionPolicy = await resolveRedactionPolicy(this.prisma, envelope.orgId);
    const sanitizedEnvelopePayload = applyRedactionPolicy({
      payload: envelope.payload,
      policy: redactionPolicy
    });

    let nextSeq = 0;

    try {
      nextSeq = await this.prisma.$transaction(
        async (tx) => {
          const latest = await tx.intentEvent.findFirst({
            where: {
              taskId
            },
            orderBy: {
              eventSeq: "desc"
            },
            select: {
              eventSeq: true
            }
          });

          const computedNextSeq = Number(latest?.eventSeq ?? 0n) + 1;
          const requestedSeq = envelope.sequence ?? computedNextSeq;

          if (envelope.sequence !== undefined && envelope.sequence < computedNextSeq) {
            throw new BadRequestException(
              `Event sequence ${envelope.sequence} is stale. Next expected sequence is ${computedNextSeq}`
            );
          }

          await tx.intentEvent.create({
            data: {
              id: envelope.eventId,
              orgId: envelope.orgId,
              projectId: envelope.projectId,
              taskId,
              branchId,
              actorUserId: envelope.actor.userId,
              source: envelope.source,
              eventType: envelope.type,
              eventSeq: BigInt(requestedSeq),
              payload: toJson(sanitizedEnvelopePayload.payload),
              redactionLevel: sanitizedEnvelopePayload.redactionLevel,
              occurredAt: new Date(envelope.timestamp)
            }
          });

          return requestedSeq;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        Array.isArray(error.meta?.target)
      ) {
        const target = error.meta.target.join(",");
        if (target.includes("id")) {
          return {
            accepted: true,
            eventId: envelope.eventId,
            sequence: envelope.sequence,
            idempotent: true
          };
        }

        if (target.includes("eventSeq")) {
          throw new BadRequestException(
            "Event sequence conflict detected. Retry with the latest sequence from /intent/timeline."
          );
        }
      }

      throw error;
    }

    await this.intentNormalizeQueue.add("normalize", {
      eventId: envelope.eventId,
      taskId,
      projectId: envelope.projectId,
      orgId: envelope.orgId
    }, reliableQueueOptions);

    await this.analyticsQueue.add("rollup", {
      orgId: envelope.orgId,
      projectId: envelope.projectId,
      taskId,
      source: "intent_event"
    }, reliableQueueOptions);

    return {
      accepted: true,
      eventId: envelope.eventId,
      sequence: nextSeq,
      idempotent: false
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get("timeline")
  async timeline(@Query() query: Record<string, unknown>) {
    const input = timelineQuerySchema.parse(query);

    const intentEvents = await this.prisma.intentEvent.findMany({
      where: {
        taskId: input.taskId
      },
      orderBy: {
        eventSeq: "asc"
      },
      take: input.limit
    });

    if (!input.includeRelated) {
      return intentEvents;
    }

    const [taskDecisions, activityEvents, qualityRuns, handoffs, conflicts, branches] = await Promise.all([
      this.prisma.taskDecision.findMany({
        where: {
          taskId: input.taskId
        },
        orderBy: {
          createdAt: "asc"
        },
        take: input.limit
      }),
      this.prisma.activityEvent.findMany({
        where: {
          taskId: input.taskId
        },
        orderBy: {
          occurredAt: "asc"
        },
        take: input.limit
      }),
      this.prisma.qualityGateRun.findMany({
        where: {
          taskId: input.taskId
        },
        include: {
          checks: true
        },
        orderBy: {
          createdAt: "asc"
        },
        take: input.limit
      }),
      this.prisma.handoffPacket.findMany({
        where: {
          taskId: input.taskId
        },
        include: {
          acks: true
        },
        orderBy: {
          createdAt: "asc"
        },
        take: input.limit
      }),
      this.prisma.conflictEvent.findMany({
        where: {
          OR: [{ taskId: input.taskId }, { otherTaskId: input.taskId }]
        },
        orderBy: {
          createdAt: "asc"
        },
        take: input.limit
      }),
      this.prisma.branch.findMany({
        where: {
          taskId: input.taskId
        },
        include: {
          pullRequests: {
            orderBy: {
              createdAt: "asc"
            }
          }
        },
        orderBy: {
          createdAt: "asc"
        },
        take: input.limit
      })
    ]);

    const timeline = [
      ...intentEvents.map((event) => ({
        timestamp: event.occurredAt,
        type: event.eventType,
        category: "intent",
        id: event.id,
        data: event
      })),
      ...taskDecisions.map((decision) => ({
        timestamp: decision.createdAt,
        type: `decision.${decision.decisionType}`,
        category: "decision",
        id: decision.id,
        data: decision
      })),
      ...activityEvents.map((event) => ({
        timestamp: event.occurredAt,
        type: event.eventType,
        category: "activity",
        id: event.id,
        data: event
      })),
      ...qualityRuns.map((run) => ({
        timestamp: run.createdAt,
        type: `quality.${run.status}`,
        category: "quality",
        id: run.id,
        data: run
      })),
      ...handoffs.map((handoff) => ({
        timestamp: handoff.createdAt,
        type: "handoff.created",
        category: "handoff",
        id: handoff.id,
        data: handoff
      })),
      ...conflicts.map((conflict) => ({
        timestamp: conflict.createdAt,
        type: `conflict.${conflict.severity}`,
        category: "conflict",
        id: conflict.id,
        data: conflict
      })),
      ...branches.map((branch) => ({
        timestamp: branch.createdAt,
        type: "branch.created",
        category: "branch",
        id: branch.id,
        data: branch
      }))
    ].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

    return {
      taskId: input.taskId,
      counts: {
        intentEvents: intentEvents.length,
        decisions: taskDecisions.length,
        activityEvents: activityEvents.length,
        qualityRuns: qualityRuns.length,
        handoffs: handoffs.length,
        conflicts: conflicts.length,
        branches: branches.length
      },
      timeline
    };
  }

  @Roles("owner", "admin", "member")
  @Post("commit-metadata")
  async ingestCommitMetadata(@Body() body: unknown) {
    const input = commitMetadataSchema.parse(body);

    const [task, branch] = await Promise.all([
      this.prisma.task.findUnique({
        where: {
          id: input.taskId
        }
      }),
      input.branchId
        ? this.prisma.branch.findUnique({
            where: {
              id: input.branchId
            }
          })
        : Promise.resolve(null)
    ]);

    if (!task) {
      throw new BadRequestException("Task not found for commit metadata ingestion");
    }

    if (input.branchId && !branch) {
      throw new BadRequestException("Branch not found for commit metadata ingestion");
    }

    if (task.projectId !== input.projectId || task.orgId !== input.orgId) {
      throw new BadRequestException("Task scope mismatch for org/project");
    }

    const run = await this.prisma.aiRun.upsert({
      where: {
        id: input.runId
      },
      update: {
        branchId: input.branchId,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        latencyMs: input.latencyMs,
        status: "completed",
        endedAt: new Date()
      },
      create: {
        id: input.runId,
        orgId: input.orgId,
        projectId: input.projectId,
        taskId: input.taskId,
        branchId: input.branchId,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        latencyMs: input.latencyMs,
        status: "completed",
        startedAt: new Date(),
        endedAt: new Date()
      }
    });

    await this.prisma.taskDecision.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        taskId: input.taskId,
        decisionType: "commit_metadata_linked",
        summary: `Commit ${input.commitSha.slice(0, 12)} linked to run ${input.runId}`,
        rationale: JSON.stringify({
          commitSha: input.commitSha,
          runId: input.runId,
          intentId: input.intentId,
          branchId: input.branchId
        })
      }
    });

    return {
      ok: true,
      runId: run.id,
      taskId: input.taskId,
      branchId: input.branchId,
      commitSha: input.commitSha
    };
  }
}
