import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";

import { appendAuditLog } from "../../common/audit.js";
import { PrismaService } from "../../common/prisma.service.js";
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
    private readonly prisma: PrismaService
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

    return task;
  }
}
