import { randomUUID } from "node:crypto";

import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { z } from "zod";

import { PrismaService } from "../../common/prisma.service.js";
import { reliableQueueOptions } from "../../common/queue-options.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";

const handoffSchema = z.object({
  taskId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  summary: z.string(),
  constraints: z.string().optional(),
  risks: z.string().optional(),
  nextSteps: z.string().optional()
});

const ackSchema = z.object({
  notes: z.string().optional()
});

@Controller("handoffs")
export class HandoffsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue("queue.handoff.generate") private readonly handoffQueue: Queue
  ) {}

  @Roles("owner", "admin", "member")
  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = handoffSchema.parse(body);

    const task = await this.prisma.task.findUnique({
      where: {
        id: input.taskId
      }
    });

    if (!task) {
      return null;
    }

    const handoff = await this.prisma.handoffPacket.create({
      data: {
        orgId: task.orgId,
        projectId: task.projectId,
        taskId: task.id,
        branchId: input.branchId,
        generatedBy: user.userId,
        summary: input.summary,
        constraints: input.constraints,
        risks: input.risks,
        nextSteps: input.nextSteps,
        payload: {
          summary: input.summary,
          constraints: input.constraints,
          risks: input.risks,
          nextSteps: input.nextSteps
        }
      }
    });

    await this.handoffQueue.add("generate", {
      handoffId: handoff.id,
      taskId: handoff.taskId,
      projectId: handoff.projectId
    }, reliableQueueOptions);

    this.realtime.emitToProject(task.projectId, "handoff.created", {
      eventId: randomUUID(),
      orgId: task.orgId,
      projectId: task.projectId,
      source: "worker",
      type: "handoff.created",
      timestamp: new Date().toISOString(),
      actor: {
        userId: user.userId,
        clientId: undefined
      },
      context: {
        taskId: task.id,
        branchId: input.branchId,
        repositoryId: task.repositoryId
      },
      payload: {
        handoffId: handoff.id,
        summary: handoff.summary
      }
    });

    return handoff;
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get(":id")
  async get(@Param("id") id: string) {
    return this.prisma.handoffPacket.findUnique({
      where: {
        id
      },
      include: {
        acks: true
      }
    });
  }

  @Roles("owner", "admin", "member")
  @Post(":id/ack")
  async ack(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = ackSchema.parse(body);

    return this.prisma.handoffAck.upsert({
      where: {
        handoffPacketId_ackBy: {
          handoffPacketId: id,
          ackBy: user.userId
        }
      },
      update: {
        notes: input.notes,
        ackAt: new Date()
      },
      create: {
        handoffPacketId: id,
        ackBy: user.userId,
        ackAt: new Date(),
        notes: input.notes
      }
    });
  }
}
