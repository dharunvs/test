import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import type { AuthContext } from "../src/modules/auth/auth.types.js";
import { PivotController } from "../src/modules/pivot/pivot.controller.js";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const TASK_ID = "33333333-3333-3333-3333-333333333333";
const BRANCH_ID = "44444444-4444-4444-4444-444444444444";

const USER: AuthContext = {
  userId: "55555555-5555-5555-5555-555555555555",
  clerkUserId: "clerk_user_1",
  email: "owner@branchline.dev",
  role: "owner"
};

describe("PivotController", () => {
  it("enables pivot mode and creates stale context reports", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: PROJECT_ID,
          orgId: ORG_ID
        })
      },
      task: {
        findMany: vi.fn().mockResolvedValue([{ id: TASK_ID }])
      },
      branch: {
        findMany: vi.fn().mockResolvedValue([{ id: BRANCH_ID }])
      },
      pivotEvent: {
        create: vi.fn().mockResolvedValue({
          id: "66666666-6666-6666-6666-666666666666",
          title: "Pivot plan",
          createdAt: new Date("2026-03-11T01:00:00.000Z")
        })
      },
      staleContextReport: {
        createMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    } as unknown as PrismaService;

    const realtime = {
      emitToProject: vi.fn()
    };

    const analyticsQueue = {
      add: vi.fn().mockResolvedValue(undefined)
    };

    const controller = new PivotController(prisma, realtime as never, analyticsQueue as never);
    const result = await controller.enable(
      {
        projectId: PROJECT_ID,
        title: "Pivot plan",
        description: "Breaking scope change"
      },
      USER
    );

    expect(result).toEqual({
      pivotId: "66666666-6666-6666-6666-666666666666",
      projectId: PROJECT_ID,
      staleEntitiesQueued: 2,
      createdAt: new Date("2026-03-11T01:00:00.000Z")
    });
    expect(prisma.staleContextReport.createMany).toHaveBeenCalledTimes(2);
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      "pivot.mode_enabled",
      expect.objectContaining({
        orgId: ORG_ID,
        projectId: PROJECT_ID
      })
    );
    expect(analyticsQueue.add).toHaveBeenCalledWith(
      "rollup",
      expect.objectContaining({
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        source: "pivot_mode_enabled"
      }),
      expect.any(Object)
    );
  });

  it("throws not found when project does not exist", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaService;

    const controller = new PivotController(
      prisma,
      {
        emitToProject: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never
    );

    await expect(
      controller.enable(
        {
          projectId: PROJECT_ID,
          title: "Pivot plan"
        },
        USER
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
