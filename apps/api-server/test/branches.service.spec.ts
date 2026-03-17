import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { BranchesService } from "../src/modules/branches/branches.service.js";

describe("BranchesService", () => {
  it("blocks branch creation on protected branch", async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: "11111111-1111-1111-1111-111111111111",
          orgId: "22222222-2222-2222-2222-222222222222",
          projectId: "33333333-3333-3333-3333-333333333333",
          repositoryId: "44444444-4444-4444-4444-444444444444",
          title: "Protected branch task"
        })
      },
      policySet: {
        findFirst: vi.fn().mockResolvedValue({
          config: {
            baseBranch: "main",
            protectedBranches: ["main"],
            autoPush: false,
            autoPr: false,
            staleThresholdMinutes: 120,
            cleanupAfterMergeHours: 24
          }
        })
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn()
      },
      pullRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn(),
        create: vi.fn()
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "audit-1" })
      }
    } as unknown as PrismaService;

    const service = new BranchesService(prisma);

    const result = await service.createBranch({
      projectId: "33333333-3333-3333-3333-333333333333",
      taskId: "11111111-1111-1111-1111-111111111111",
      ticketOrTask: "HB-1",
      taskSlug: "protected-branch-test",
      currentBranch: "main",
      actorUserId: "55555555-5555-5555-5555-555555555555"
    });

    expect(result.blocked).toBe(true);
  });

  it("creates task branch from policy base", async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: "11111111-1111-1111-1111-111111111111",
          orgId: "22222222-2222-2222-2222-222222222222",
          projectId: "33333333-3333-3333-3333-333333333333",
          repositoryId: "44444444-4444-4444-4444-444444444444",
          title: "Task"
        })
      },
      policySet: {
        findFirst: vi.fn().mockResolvedValue({
          config: {
            baseBranch: "develop",
            protectedBranches: ["main", "develop"],
            autoPush: false,
            autoPr: false,
            staleThresholdMinutes: 120,
            cleanupAfterMergeHours: 24
          }
        })
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "66666666-6666-6666-6666-666666666666",
          name: "ai/hb-2/branch-create-test-20260309T103000Z",
          baseBranch: "develop"
        })
      },
      pullRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn(),
        create: vi.fn()
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "audit-2" })
      }
    } as unknown as PrismaService;

    const service = new BranchesService(prisma);

    const result = await service.createBranch({
      projectId: "33333333-3333-3333-3333-333333333333",
      taskId: "11111111-1111-1111-1111-111111111111",
      ticketOrTask: "HB-2",
      taskSlug: "branch-create-test",
      currentBranch: "feature/local",
      actorUserId: "55555555-5555-5555-5555-555555555555"
    });

    expect(result.blocked).toBe(false);
    if (result.blocked) {
      throw new Error("Expected unblocked branch creation");
    }

    expect(result.branch).toBeDefined();
    if (!result.branch) {
      throw new Error("Expected branch to be defined");
    }

    expect(result.branch.baseBranch).toBe("develop");
    expect(result.branch.name.startsWith("ai/hb-2/branch-create-test-")).toBe(true);
  });
});
