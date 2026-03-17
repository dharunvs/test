import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { BranchesService } from "../src/modules/branches/branches.service.js";

describe("BranchesService policy sweeps", () => {
  it("marks stale branches using project policy threshold", async () => {
    const prisma = {
      policySet: {
        findFirst: vi.fn().mockResolvedValue({
          config: {
            baseBranch: "main",
            protectedBranches: ["main"],
            autoPush: false,
            autoPr: true,
            staleThresholdMinutes: 60,
            cleanupAfterMergeHours: 24
          }
        })
      },
      branch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "branch-1",
            orgId: "22222222-2222-2222-2222-222222222222",
            projectId: "33333333-3333-3333-3333-333333333333",
            repositoryId: "44444444-4444-4444-4444-444444444444",
            taskId: "55555555-5555-5555-5555-555555555555",
            name: "ai/task/stale"
          }
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "audit-1" })
      }
    } as unknown as PrismaService;

    const service = new BranchesService(prisma);

    const result = await service.markStaleBranches({
      projectId: "33333333-3333-3333-3333-333333333333",
      actorUserId: "66666666-6666-6666-6666-666666666666"
    });

    expect(result.markedStale).toBe(1);
    expect(prisma.branch.updateMany).toHaveBeenCalledTimes(1);
  });

  it("cleans merged branches using cleanup threshold", async () => {
    const prisma = {
      policySet: {
        findFirst: vi.fn().mockResolvedValue({
          config: {
            baseBranch: "main",
            protectedBranches: ["main"],
            autoPush: false,
            autoPr: true,
            staleThresholdMinutes: 60,
            cleanupAfterMergeHours: 24
          }
        })
      },
      branch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "branch-merged-1",
            orgId: "22222222-2222-2222-2222-222222222222",
            name: "ai/task/merged"
          }
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "audit-2" })
      }
    } as unknown as PrismaService;

    const service = new BranchesService(prisma);

    const result = await service.cleanupMergedBranches({
      projectId: "33333333-3333-3333-3333-333333333333",
      actorUserId: "66666666-6666-6666-6666-666666666666"
    });

    expect(result.cleaned).toBe(1);
    expect(prisma.branch.updateMany).toHaveBeenCalledTimes(1);
  });
});
