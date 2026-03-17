import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { TasksService } from "../src/modules/tasks/tasks.service.js";

describe("TasksService", () => {
  it("lists tasks by project and status with relation previews", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      task: {
        findMany
      }
    } as unknown as PrismaService;

    const service = new TasksService(prisma);

    await service.listTasks({
      projectId: "11111111-1111-1111-1111-111111111111",
      status: "in_progress",
      limit: 25
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "11111111-1111-1111-1111-111111111111",
          status: "in_progress"
        },
        take: 25
      })
    );
  });

  it("loads task details with branches, quality runs, and handoffs", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "task-1"
    });
    const prisma = {
      task: {
        findUnique
      }
    } as unknown as PrismaService;

    const service = new TasksService(prisma);

    await service.getTaskDetails("task-1");

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "task-1"
        },
        include: expect.objectContaining({
          branches: expect.any(Object),
          qualityGateRuns: expect.any(Object),
          handoffPackets: expect.any(Object)
        })
      })
    );
  });

  it("builds deterministic review digest from task intent/activity/conflict/quality signals", async () => {
    const now = new Date("2026-03-11T12:00:00.000Z");
    const taskFindUnique = vi.fn().mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      branches: [
        {
          id: "branch-1",
          name: "task/one",
          pullRequests: [
            {
              id: "pr-1",
              number: 41,
              status: "open",
              url: "https://example.test/pr/41"
            }
          ]
        }
      ]
    });

    const prisma = {
      task: {
        findUnique: taskFindUnique
      },
      intentEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "intent-1",
            eventType: "intent.created",
            eventSeq: 1n,
            occurredAt: now
          }
        ])
      },
      activityEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "activity-1",
            eventType: "activity.file_opened",
            occurredAt: now
          }
        ])
      },
      conflictEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "conflict-1",
            severity: "high",
            score: "81",
            reasonCodes: ["symbol_overlap", "file_overlap"],
            resolutionStatus: "open"
          }
        ])
      },
      handoffPacket: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "handoff-1",
            createdAt: now,
            acks: []
          }
        ])
      },
      qualityGateRun: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "run-1",
            status: "failed",
            checks: [
              { checkKey: "build", status: "passed" },
              { checkKey: "lint", status: "failed" }
            ]
          }
        ])
      },
      prSlice: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "slice-1",
            pullRequestId: "pr-1",
            sliceOrder: 1,
            title: "API changes",
            description: "Endpoint updates",
            riskLevel: "medium",
            status: "open",
            filePaths: ["apps/api-server/src/modules/tasks/tasks.controller.ts"],
            createdAt: now,
            pullRequest: {
              id: "pr-1",
              number: 41,
              status: "open",
              url: "https://example.test/pr/41",
              branch: {
                id: "branch-1",
                name: "task/one",
                status: "active"
              }
            }
          }
        ])
      },
      policySet: {
        findFirst: vi.fn().mockResolvedValue({
          config: {
            requiredQualityChecks: ["build", "lint", "unit_tests"]
          }
        })
      }
    } as unknown as PrismaService;

    const service = new TasksService(prisma);

    const first = await service.buildReviewDigest("task-1");
    const second = await service.buildReviewDigest("task-1");

    expect(first.digestHash).toBe(second.digestHash);
    expect(first.summary).toEqual(
      expect.objectContaining({
        intentEvents: 1,
        activityEvents: 1,
        openConflicts: 1,
        prSliceCount: 1,
        latestQualityStatus: "failed",
        failedCheckCount: 1,
        missingRequiredChecks: 2
      })
    );
    expect(first.sources.quality.missingRequiredChecks).toEqual(["lint", "unit_tests"]);
    expect(first.reasonCodes).toEqual(["file_overlap", "symbol_overlap"]);
    expect(first.recommendedAction).toBe("prioritize_conflict_and_quality_review");
  });
});
