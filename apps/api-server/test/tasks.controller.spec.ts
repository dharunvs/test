import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { TasksController } from "../src/modules/tasks/tasks.controller.js";
import type { TasksService } from "../src/modules/tasks/tasks.service.js";

describe("TasksController", () => {
  it("returns PR slices when task exists", async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: "task-1"
        })
      }
    } as unknown as PrismaService;

    const tasksService = {
      listPrSlices: vi.fn().mockResolvedValue([{ id: "slice-1", taskId: "task-1" }])
    } as unknown as TasksService;

    const controller = new TasksController(
      tasksService,
      prisma,
      {
        add: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never
    );

    const result = await controller.listTaskPrSlices("task-1");
    expect(result).toEqual([{ id: "slice-1", taskId: "task-1" }]);
    expect(tasksService.listPrSlices).toHaveBeenCalledWith("task-1");
  });

  it("throws not found for PR slices when task is missing", async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaService;

    const controller = new TasksController(
      {
        listPrSlices: vi.fn()
      } as never,
      prisma,
      {
        add: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never
    );

    await expect(controller.listTaskPrSlices("task-missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns review digest generated from signals", async () => {
    const tasksService = {
      buildReviewDigest: vi.fn().mockResolvedValue({
        taskId: "task-1",
        digestHash: "abc123",
        summary: {
          intentEvents: 2,
          activityEvents: 1,
          openConflicts: 1
        }
      })
    } as unknown as TasksService;

    const controller = new TasksController(
      tasksService,
      {
        task: {
          findUnique: vi.fn()
        }
      } as never,
      {
        add: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never
    );

    const digest = await controller.getTaskReviewDigest("task-1");
    expect(digest).toEqual(
      expect.objectContaining({
        taskId: "task-1",
        digestHash: "abc123"
      })
    );
    expect(tasksService.buildReviewDigest).toHaveBeenCalledWith("task-1");
  });
});
