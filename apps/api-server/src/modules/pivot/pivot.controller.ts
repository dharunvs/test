import { randomUUID } from "node:crypto";

import { Body, Controller, Get, NotFoundException, Post, Query } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { z } from "zod";

import { PrismaService } from "../../common/prisma.service.js";
import { reliableQueueOptions } from "../../common/queue-options.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";

const pivotSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(2),
  description: z.string().optional()
});

const listPivotSchema = z.object({
  projectId: z.string().uuid(),
  limit: z.coerce.number().int().positive().max(100).default(20)
});

@Controller("pivot")
export class PivotController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue("queue.analytics.rollup") private readonly analyticsQueue: Queue
  ) {}

  @Roles("owner", "admin", "member", "viewer")
  @Get("reports")
  async listReports(@Query() query: Record<string, unknown>) {
    const input = listPivotSchema.parse(query);

    const events = await this.prisma.pivotEvent.findMany({
      where: {
        projectId: input.projectId
      },
      include: {
        staleReports: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: input.limit
    });

    return events.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      effectiveAt: event.effectiveAt,
      createdAt: event.createdAt,
      staleReports: event.staleReports
    }));
  }

  @Roles("owner", "admin")
  @Post("enable")
  async enable(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = pivotSchema.parse(body);

    const project = await this.prisma.project.findUnique({
      where: {
        id: input.projectId
      }
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    const staleTasks = await this.prisma.task.findMany({
      where: {
        projectId: input.projectId,
        status: {
          in: ["todo", "in_progress", "blocked", "review"]
        }
      },
      select: {
        id: true
      }
    });

    const staleBranches = await this.prisma.branch.findMany({
      where: {
        projectId: input.projectId,
        status: {
          in: ["active", "stale"]
        }
      },
      select: {
        id: true
      }
    });

    const pivotEvent = await this.prisma.pivotEvent.create({
      data: {
        orgId: project.orgId,
        projectId: project.id,
        triggeredBy: user.userId,
        title: input.title,
        description: input.description,
        baselinePayload: {
          staleTaskCount: staleTasks.length,
          staleBranchCount: staleBranches.length
        },
        effectiveAt: new Date()
      }
    });

    if (staleTasks.length > 0) {
      await this.prisma.staleContextReport.createMany({
        data: staleTasks.map((task) => ({
          pivotEventId: pivotEvent.id,
          entityType: "task",
          entityId: task.id,
          reason: "project_pivot"
        }))
      });
    }

    if (staleBranches.length > 0) {
      await this.prisma.staleContextReport.createMany({
        data: staleBranches.map((branch) => ({
          pivotEventId: pivotEvent.id,
          entityType: "branch",
          entityId: branch.id,
          reason: "project_pivot"
        }))
      });
    }

    this.realtime.emitToProject(project.id, "pivot.mode_enabled", {
      eventId: randomUUID(),
      orgId: project.orgId,
      projectId: project.id,
      source: "web_console",
      type: "pivot.mode_enabled",
      timestamp: new Date().toISOString(),
      actor: {
        userId: user.userId,
        clientId: undefined
      },
      context: {
        taskId: undefined,
        branchId: undefined,
        repositoryId: undefined
      },
      payload: {
        pivotEventId: pivotEvent.id,
        title: pivotEvent.title
      }
    });

    await this.analyticsQueue.add("rollup", {
      orgId: project.orgId,
      projectId: project.id,
      source: "pivot_mode_enabled",
      pivotEventId: pivotEvent.id
    }, reliableQueueOptions);

    return {
      pivotId: pivotEvent.id,
      projectId: project.id,
      staleEntitiesQueued: staleTasks.length + staleBranches.length,
      createdAt: pivotEvent.createdAt
    };
  }
}
