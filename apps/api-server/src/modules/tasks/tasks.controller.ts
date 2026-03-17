import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { z } from "zod";

import { appendAuditLog } from "../../common/audit.js";
import { PrismaService } from "../../common/prisma.service.js";
import { reliableQueueOptions } from "../../common/queue-options.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { TasksService } from "./tasks.service.js";

const startTaskSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  title: z.string().min(2)
});

const listTaskQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(["todo", "in_progress", "blocked", "review", "done", "archived"]).optional(),
  limit: z.coerce.number().int().positive().max(100).default(25)
});

@Controller("tasks")
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly prisma: PrismaService,
    @InjectQueue("queue.handoff.generate") private readonly handoffQueue: Queue,
    @InjectQueue("queue.analytics.rollup") private readonly analyticsQueue: Queue
  ) {}

  @Roles("owner", "admin", "member", "viewer")
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const input = listTaskQuerySchema.parse(query);

    if (!input.projectId) {
      return [];
    }

    return this.tasksService.listTasks(input);
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get(":id")
  async get(@Param("id") id: string) {
    const task = await this.tasksService.getTaskDetails(id);
    if (!task) {
      throw new NotFoundException("Task not found");
    }

    return task;
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get(":id/handoffs")
  async listTaskHandoffs(@Param("id") id: string) {
    const task = await this.prisma.task.findUnique({
      where: {
        id
      },
      select: {
        id: true
      }
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    return this.prisma.handoffPacket.findMany({
      where: {
        taskId: id
      },
      include: {
        acks: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get(":id/conflicts")
  async listTaskConflicts(@Param("id") id: string) {
    const task = await this.prisma.task.findUnique({
      where: {
        id
      },
      select: {
        id: true,
        projectId: true
      }
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    return this.prisma.conflictEvent.findMany({
      where: {
        projectId: task.projectId,
        OR: [{ taskId: id }, { otherTaskId: id }]
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 200
    });
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get(":id/pr-slices")
  async listTaskPrSlices(@Param("id") id: string) {
    const task = await this.prisma.task.findUnique({
      where: {
        id
      },
      select: {
        id: true
      }
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    return this.tasksService.listPrSlices(id);
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get(":id/review-digest")
  async getTaskReviewDigest(@Param("id") id: string) {
    return this.tasksService.buildReviewDigest(id);
  }

  @Roles("owner", "admin", "member")
  @Post("start")
  async start(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = startTaskSchema.parse(body);
    const task = await this.tasksService.createTask({
      ...input,
      actorUserId: user.userId
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: task.orgId,
      projectId: task.projectId,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "task.started",
      entityType: "task",
      entityId: task.id,
      payload: {
        title: task.title
      }
    });

    await this.analyticsQueue.add("rollup", {
      orgId: task.orgId,
      projectId: task.projectId,
      taskId: task.id,
      source: "task_started"
    }, reliableQueueOptions);

    return task;
  }

  @Roles("owner", "admin", "member")
  @Post(":id/handoff")
  async createHandoff(@Param("id") id: string, @CurrentUser() user: AuthContext) {
    const handoff = await this.tasksService.createHandoff(id, user.userId);
    if (!handoff) {
      throw new NotFoundException("Task not found");
    }

    await appendAuditLog({
      prisma: this.prisma,
      orgId: handoff.orgId,
      projectId: handoff.projectId,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "handoff.generated",
      entityType: "handoff",
      entityId: handoff.id,
      payload: {
        taskId: handoff.taskId
      }
    });

    await this.handoffQueue.add("generate", {
      handoffId: handoff.id,
      taskId: handoff.taskId,
      projectId: handoff.projectId,
      orgId: handoff.orgId
    }, reliableQueueOptions);

    return {
      id: handoff.id,
      taskId: handoff.taskId,
      summary: handoff.summary,
      createdAt: handoff.createdAt
    };
  }
}
