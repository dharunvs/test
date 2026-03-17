import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { BranchesService } from "../src/modules/branches/branches.service.js";

describe("BranchesService ensurePullRequest", () => {
  it("fails closed by default when repository provider is not github", async () => {
    const prisma = {
      branch: {
        findUnique: vi.fn().mockResolvedValue({
          id: "11111111-1111-1111-1111-111111111111",
          orgId: "22222222-2222-2222-2222-222222222222",
          projectId: "33333333-3333-3333-3333-333333333333",
          repositoryId: "44444444-4444-4444-4444-444444444444",
          taskId: "55555555-5555-5555-5555-555555555555",
          name: "ai/task/demo-20260309T000000Z",
          baseBranch: "main",
          repository: {
            provider: "gitlab",
            owner: "team",
            name: "repo",
            fullName: "team/repo",
            metadata: {}
          },
          task: {
            title: "Demo task"
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
            cleanupAfterMergeHours: 24
          }
        })
      },
      pullRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({
          id: "66666666-6666-6666-6666-666666666666",
          number: 900001,
          status: "draft"
        })
      },
      guardrailEvaluation: {
        findFirst: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaService;

    const service = new BranchesService(prisma);
    const result = await service.ensurePullRequest({
      branchId: "11111111-1111-1111-1111-111111111111",
      actorUserId: "77777777-7777-7777-7777-777777777777"
    });

    expect(result.providerMode).toBe("github");
    expect(result.pullRequest).toBeNull();
    expect(result.reason).toBe("fail_closed:repository_provider_not_supported_for_auto_pr");
  });

  it("allows placeholder pull request only when explicit local override is enabled", async () => {
    const prisma = {
      branch: {
        findUnique: vi.fn().mockResolvedValue({
          id: "11111111-1111-1111-1111-111111111111",
          orgId: "22222222-2222-2222-2222-222222222222",
          projectId: "33333333-3333-3333-3333-333333333333",
          repositoryId: "44444444-4444-4444-4444-444444444444",
          taskId: "55555555-5555-5555-5555-555555555555",
          name: "ai/task/demo-20260309T000000Z",
          baseBranch: "main",
          repository: {
            provider: "gitlab",
            owner: "team",
            name: "repo",
            fullName: "team/repo",
            metadata: {}
          },
          task: {
            title: "Demo task"
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
            cleanupAfterMergeHours: 24
          }
        })
      },
      pullRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({
          id: "66666666-6666-6666-6666-666666666666",
          number: 900001,
          status: "draft"
        })
      },
      guardrailEvaluation: {
        findFirst: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaService;

    const service = new BranchesService(prisma);
    Object.defineProperty(service, "env", {
      value: {
        nodeEnv: "development",
        githubAllowPlaceholderPr: true
      },
      configurable: true
    });

    const result = await service.ensurePullRequest({
      branchId: "11111111-1111-1111-1111-111111111111",
      actorUserId: "77777777-7777-7777-7777-777777777777"
    });

    expect(result.providerMode).toBe("placeholder");
    expect(result.pullRequest?.number).toBe(900001);
    expect(result.reason).toBe("repository_provider_not_supported_for_auto_pr");
  });

  it("fails closed in production when github app credentials are missing", async () => {
    const prisma = {
      branch: {
        findUnique: vi.fn().mockResolvedValue({
          id: "11111111-1111-1111-1111-111111111111",
          orgId: "22222222-2222-2222-2222-222222222222",
          projectId: "33333333-3333-3333-3333-333333333333",
          repositoryId: "44444444-4444-4444-4444-444444444444",
          taskId: "55555555-5555-5555-5555-555555555555",
          name: "ai/task/demo-20260309T000000Z",
          baseBranch: "main",
          repository: {
            provider: "github",
            owner: "team",
            name: "repo",
            fullName: "team/repo",
            metadata: {}
          },
          task: {
            title: "Demo task"
          }
        })
      },
      policySet: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            config: {
              baseBranch: "main",
              protectedBranches: ["main"],
              autoPush: true,
              autoPr: true,
              staleThresholdMinutes: 120,
              cleanupAfterMergeHours: 24
            }
          })
          .mockResolvedValueOnce(null)
      },
      guardrailEvaluation: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      pullRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn(),
        create: vi.fn()
      }
    } as unknown as PrismaService;

    const service = new BranchesService(prisma);
    Object.defineProperty(service, "env", {
      value: {
        nodeEnv: "production",
        githubAppId: undefined,
        githubAppPrivateKey: undefined
      },
      configurable: true
    });

    const result = await service.ensurePullRequest({
      branchId: "11111111-1111-1111-1111-111111111111",
      actorUserId: "77777777-7777-7777-7777-777777777777"
    });

    expect(result.created).toBe(false);
    expect(result.pullRequest).toBeNull();
    expect(result.providerMode).toBe("github");
    expect(result.reason).toBe("fail_closed:github_app_credentials_missing");
    expect(prisma.pullRequest.create).not.toHaveBeenCalled();
  });
});
