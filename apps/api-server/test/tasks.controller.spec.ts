import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { TasksController } from "../src/modules/tasks/tasks.controller.js";
import type { TasksService } from "../src/modules/tasks/tasks.service.js";

describe("TasksController", () => {
  it("returns empty list when projectId is missing", async () => {
    const controller = new TasksController(
      {
        listTasks: vi.fn()
      } as never,
      {
        task: {
          findUnique: vi.fn()
        }
      } as never
    );

    const result = await controller.list({});
    expect(result).toEqual([]);
  });

  it("throws not found when task does not exist", async () => {
    const controller = new TasksController(
      {
        getTaskDetails: vi.fn().mockResolvedValue(null)
      } as unknown as TasksService,
      {
        task: {
          findUnique: vi.fn()
        }
      } as unknown as PrismaService
    );

    await expect(controller.get("task-missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("starts a task and writes audit log", async () => {
    const createTask = vi.fn().mockResolvedValue({
      id: "task-1",
      orgId: "11111111-1111-1111-1111-111111111111",
      projectId: "22222222-2222-2222-2222-222222222222",
      repositoryId: "33333333-3333-3333-3333-333333333333",
      title: "Start wedge task"
    });
    const findFirst = vi.fn().mockResolvedValue(null);
    const createAudit = vi.fn().mockResolvedValue({});

    const controller = new TasksController(
      {
        createTask
      } as unknown as TasksService,
      {
        auditLog: {
          findFirst,
          create: createAudit
        }
      } as unknown as PrismaService
    );

    const result = await controller.start(
      {
        orgId: "11111111-1111-1111-1111-111111111111",
        projectId: "22222222-2222-2222-2222-222222222222",
        repositoryId: "33333333-3333-3333-3333-333333333333",
        title: "Start wedge task"
      },
      {
        userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        clerkUserId: "clerk_aaaaaaaa",
        email: "member@example.com",
        role: "member"
      }
    );

    expect(result.id).toBe("task-1");
    expect(createTask).toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalled();
    expect(createAudit).toHaveBeenCalled();
  });
});
