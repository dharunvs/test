import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { BranchesService } from "../src/modules/branches/branches.service.js";

describe("BranchesService mergeBranch", () => {
  it("blocks merge when promotion gate fails", async () => {
    const prisma = {
      branch: {
        findUnique: vi.fn().mockResolvedValue({
          id: "11111111-1111-1111-1111-111111111111",
          orgId: "22222222-2222-2222-2222-222222222222",
          projectId: "33333333-3333-3333-3333-333333333333",
          repositoryId: "44444444-4444-4444-4444-444444444444",
          taskId: "55555555-5555-5555-5555-555555555555",
          repository: {
            provider: "github",
            metadata: {}
          },
          task: {
            title: "Task"
          }
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
        findFirst: vi.fn().mockResolvedValue(null)
      },
      pullRequest: {
        findFirst: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaService;

    const service = new BranchesService(prisma);
    const result = await service.mergeBranch({
      branchId: "11111111-1111-1111-1111-111111111111",
      actorUserId: "66666666-6666-6666-6666-666666666666",
      strategy: "squash",
      requireOpenPr: true,
      openDraftIfNeeded: true
    });

    expect(result.merged).toBe(false);
    expect(result.reason).toBe("merge_gate_failed:quality_run_missing");
  });
});

