import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { BranchesService } from "../src/modules/branches/branches.service.js";

describe("BranchesService promoteBranch", () => {
  it("blocks promotion when latest quality run is not passed", async () => {
    const prisma = {
      branch: {
        findUnique: vi.fn().mockResolvedValue({
          id: "11111111-1111-1111-1111-111111111111",
          orgId: "22222222-2222-2222-2222-222222222222",
          projectId: "33333333-3333-3333-3333-333333333333",
          taskId: "44444444-4444-4444-4444-444444444444"
        })
      },
      policySet: {
        findFirst: vi.fn().mockResolvedValue({
          config: {
            baseBranch: "main",
            protectedBranches: ["main"],
            autoPush: true,
            autoPr: true,
            staleThresholdMinutes: 120,
            cleanupAfterMergeHours: 24,
            requiredQualityChecks: ["build", "unit_tests", "lint", "dependency_audit"],
            enforceGuardrailRecheckOnPromote: true
          }
        })
      },
      guardrailEvaluation: {
        findFirst: vi.fn().mockResolvedValue({
          status: "pass"
        })
      },
      qualityGateRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "55555555-5555-5555-5555-555555555555",
          status: "failed",
          checks: [
            {
              checkKey: "build",
              status: "failed"
            }
          ]
        })
      },
      pullRequest: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn()
      }
    } as unknown as PrismaService;

    const service = new BranchesService(prisma);
    const result = await service.promoteBranch({
      branchId: "11111111-1111-1111-1111-111111111111",
      actorUserId: "66666666-6666-6666-6666-666666666666",
      requireOpenPr: true,
      dryRun: false
    });

    expect(result.promoted).toBe(false);
    expect(result.reason).toBe("quality_status_failed");
  });

  it("promotes when guardrails and required quality checks pass", async () => {
    const prisma = {
      branch: {
        findUnique: vi.fn().mockResolvedValue({
          id: "11111111-1111-1111-1111-111111111111",
          orgId: "22222222-2222-2222-2222-222222222222",
          projectId: "33333333-3333-3333-3333-333333333333",
          taskId: "44444444-4444-4444-4444-444444444444"
        })
      },
      policySet: {
        findFirst: vi.fn().mockResolvedValue({
          config: {
            baseBranch: "main",
            protectedBranches: ["main"],
            autoPush: true,
            autoPr: true,
            staleThresholdMinutes: 120,
            cleanupAfterMergeHours: 24,
            requiredQualityChecks: ["build", "unit_tests", "lint", "dependency_audit"],
            enforceGuardrailRecheckOnPromote: true
          }
        })
      },
      guardrailEvaluation: {
        findFirst: vi.fn().mockResolvedValue({
          status: "pass"
        })
      },
      qualityGateRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "55555555-5555-5555-5555-555555555555",
          status: "passed",
          checks: [
            { checkKey: "build", status: "passed" },
            { checkKey: "unit_tests", status: "passed" },
            { checkKey: "lint", status: "passed" },
            { checkKey: "dependency_audit", status: "passed" }
          ]
        })
      },
      pullRequest: {
        findFirst: vi.fn().mockResolvedValue({
          id: "77777777-7777-7777-7777-777777777777",
          number: 42,
          status: "open"
        })
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "audit-1"
        })
      }
    } as unknown as PrismaService;

    const service = new BranchesService(prisma);
    const result = await service.promoteBranch({
      branchId: "11111111-1111-1111-1111-111111111111",
      actorUserId: "66666666-6666-6666-6666-666666666666",
      requireOpenPr: true,
      dryRun: false
    });

    expect(result.promoted).toBe(true);
    expect(result.reason).toBe("promoted");
    expect(result.pullRequest?.number).toBe(42);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

