import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import { z } from "zod";

import { toJson } from "../../common/json.js";
import { PrismaService } from "../../common/prisma.service.js";
import { reliableQueueOptions } from "../../common/queue-options.js";
import { applyRedactionPolicy, resolveRedactionPolicy } from "../../common/redaction.js";
import { Roles } from "../auth/roles.decorator.js";

const createIntentSchema = z.object({
  taskId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(20_000),
  summary: z.string().trim().min(1).max(20_000),
  files: z.array(z.string().trim().min(1).max(500)).max(200),
  commitId: z.string().trim().min(1).max(200)
});

const listIntentQuerySchema = z.object({
  taskId: z.string().uuid(),
  limit: z.coerce.number().int().positive().max(50).default(5)
});

const intentPayloadSchema = z.object({
  prompt: z.string().optional(),
  summary: z.string().optional(),
  files: z.array(z.string()).optional(),
  commitId: z.string().optional()
});

function normalizeFiles(files: string[]): string[] {
  return Array.from(
    new Set(
      files
        .map((file) => file.trim())
        .filter((file) => file.length > 0)
        .slice(0, 200)
    )
  );
}

@Controller("intent")
export class IntentController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("queue.intent.normalize") private readonly intentNormalizeQueue: Queue
  ) {}

  @Roles("owner", "admin", "member")
  @Post()
  async create(@Body() body: unknown) {
    const input = createIntentSchema.parse(body);
    const task = await this.prisma.task.findUnique({
      where: {
        id: input.taskId
      },
      select: {
        id: true,
        orgId: true,
        projectId: true
      }
    });

    if (!task) {
      throw new BadRequestException("Task not found for intent capture");
    }

    const redactionPolicy = await resolveRedactionPolicy(this.prisma, task.orgId);
    const sanitized = applyRedactionPolicy({
      payload: {
        prompt: input.prompt,
        summary: input.summary,
        files: normalizeFiles(input.files),
        commitId: input.commitId
      },
      policy: redactionPolicy
    });

    let intentEventId = "";
    let eventSeq = 0;

    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          const latest = await tx.intentEvent.findFirst({
            where: {
              taskId: task.id
            },
            orderBy: {
              eventSeq: "desc"
            },
            select: {
              eventSeq: true
            }
          });

          const nextSeq = Number(latest?.eventSeq ?? 0n) + 1;
          const createdEvent = await tx.intentEvent.create({
            data: {
              orgId: task.orgId,
              projectId: task.projectId,
              taskId: task.id,
              source: "extension",
              eventType: "intent.captured",
              eventSeq: BigInt(nextSeq),
              payload: toJson(sanitized.payload),
              redactionLevel: sanitized.redactionLevel,
              occurredAt: new Date()
            },
            select: {
              id: true,
              eventSeq: true
            }
          });

          return {
            id: createdEvent.id,
            eventSeq: Number(createdEvent.eventSeq)
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      );

      intentEventId = created.id;
      eventSeq = created.eventSeq;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.join(",").includes("eventSeq")
      ) {
        throw new BadRequestException("Intent sequence conflict detected. Retry request.");
      }
      throw error;
    }

    await this.intentNormalizeQueue.add(
      "normalize",
      {
        eventId: intentEventId,
        taskId: task.id,
        projectId: task.projectId,
        orgId: task.orgId
      },
      reliableQueueOptions
    );

    return {
      accepted: true,
      taskId: task.id,
      eventId: intentEventId,
      eventSeq,
      redactionLevel: sanitized.redactionLevel
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const input = listIntentQuerySchema.parse(query);
    const events = await this.prisma.intentEvent.findMany({
      where: {
        taskId: input.taskId
      },
      orderBy: {
        eventSeq: "desc"
      },
      take: input.limit
    });

    return {
      taskId: input.taskId,
      events: events.map((event) => {
        const payload = intentPayloadSchema.safeParse(event.payload);
        return {
          eventId: event.id,
          eventSeq: Number(event.eventSeq),
          timestamp: event.occurredAt.toISOString(),
          prompt: payload.success ? payload.data.prompt ?? "" : "",
          summary: payload.success ? payload.data.summary ?? "" : "",
          files: payload.success ? payload.data.files ?? [] : [],
          commitId: payload.success ? payload.data.commitId ?? "" : "",
          redactionLevel: event.redactionLevel
        };
      })
    };
  }
}

