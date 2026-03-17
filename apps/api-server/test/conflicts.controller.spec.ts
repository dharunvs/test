import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import type { AuthContext } from "../src/modules/auth/auth.types.js";
import { ConflictsController } from "../src/modules/conflicts/conflicts.controller.js";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const REPOSITORY_ID = "33333333-3333-3333-3333-333333333333";
const TASK_ID = "44444444-4444-4444-4444-444444444444";
const OTHER_TASK_ID = "55555555-5555-5555-5555-555555555555";
const USER: AuthContext = {
  userId: "66666666-6666-6666-6666-666666666666",
  clerkUserId: "clerk_user_1",
  email: "member@branchline.dev",
  role: "member"
};

describe("ConflictsController", () => {
  it("scores conflict, enqueues worker processing, and emits realtime signal", async () => {
    const prisma = {
      conflictEvent: {
        create: vi.fn().mockResolvedValue({
          id: "77777777-7777-7777-7777-777777777777"
        })
      }
    } as unknown as PrismaService;

    const realtime = {
      emitToProject: vi.fn()
    };
    const conflictQueue = {
      add: vi.fn().mockResolvedValue(undefined)
    };

    const controller = new ConflictsController(prisma, realtime as never, conflictQueue as never);
    const result = await controller.score({
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      repositoryId: REPOSITORY_ID,
      taskId: TASK_ID,
      otherTaskId: OTHER_TASK_ID,
      overlappingFiles: ["a.ts", "b.ts", "c.ts", "d.ts"],
      overlappingSymbols: ["ConflictEngine", "GuardrailRule"],
      guardrailBoundaryOverlap: 60
    });

    expect(result).toEqual(
      expect.objectContaining({
        taskId: TASK_ID,
        otherTaskId: OTHER_TASK_ID,
        severity: "critical",
        reasonCodes: expect.arrayContaining(["file_overlap", "symbol_overlap", "guardrail_overlap"]),
        suggestedAction: "split_work_or_rebase_before_merge",
        conflictId: "77777777-7777-7777-7777-777777777777"
      })
    );
    expect(result.score).toBe(100);
    expect(conflictQueue.add).toHaveBeenCalledWith(
      "score",
      expect.objectContaining({
        conflictId: "77777777-7777-7777-7777-777777777777",
        projectId: PROJECT_ID,
        taskId: TASK_ID
      }),
      expect.any(Object)
    );
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      "conflict.detected",
      expect.objectContaining({
        orgId: ORG_ID,
        projectId: PROJECT_ID
      })
    );
  });

  it("includes extended overlap signals in scoring and reason codes", async () => {
    const prisma = {
      conflictEvent: {
        create: vi.fn().mockResolvedValue({
          id: "99999999-9999-9999-9999-999999999999"
        })
      }
    } as unknown as PrismaService;

    const controller = new ConflictsController(
      prisma,
      {
        emitToProject: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never
    );

    const result = await controller.score({
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      repositoryId: REPOSITORY_ID,
      taskId: TASK_ID,
      overlappingFiles: ["a.ts"],
      overlapDensity: 70,
      branchDivergenceCommits: 7,
      staleMinutes: 180,
      ownershipClaimsActive: 2,
      guardrailBoundaryOverlap: 25
    });

    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        "file_overlap",
        "dense_change_overlap",
        "branch_divergence",
        "stale_activity_overlap",
        "ownership_claim_overlap",
        "guardrail_overlap"
      ])
    );
    expect(result.scoreBreakdown).toEqual(
      expect.objectContaining({
        overlapDensity: 14,
        divergence: 14,
        staleness: 6,
        ownershipPressure: 10
      })
    );
  });

  it("creates ownership claims with TTL", async () => {
    const prisma = {
      ownershipClaim: {
        create: vi.fn().mockResolvedValue({
          id: "88888888-8888-8888-8888-888888888888",
          scopeType: "file",
          scopeValue: "apps/api-server/src/modules/conflicts/conflicts.controller.ts",
          expiresAt: new Date("2026-03-11T03:00:00.000Z")
        })
      }
    } as unknown as PrismaService;

    const controller = new ConflictsController(
      prisma,
      {
        emitToProject: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never
    );

    const result = await controller.claim(
      {
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        taskId: TASK_ID,
        scopeType: "file",
        scopeValue: "apps/api-server/src/modules/conflicts/conflicts.controller.ts",
        ttlMinutes: 90
      },
      USER
    );

    expect(result).toEqual({
      id: "88888888-8888-8888-8888-888888888888",
      scopeType: "file",
      scopeValue: "apps/api-server/src/modules/conflicts/conflicts.controller.ts",
      expiresAt: new Date("2026-03-11T03:00:00.000Z")
    });
    expect(prisma.ownershipClaim.create).toHaveBeenCalledTimes(1);
  });
});
