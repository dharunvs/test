import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import type { AuthContext } from "../src/modules/auth/auth.types.js";
import { GuardrailsController } from "../src/modules/guardrails/guardrails.controller.js";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const TASK_ID = "33333333-3333-3333-3333-333333333333";

const USER: AuthContext = {
  userId: "44444444-4444-4444-4444-444444444444",
  clerkUserId: "clerk_user_1",
  email: "member@branchline.dev",
  role: "member"
};

describe("GuardrailsController", () => {
  it("returns stage metadata and non-blocking warning result", async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: TASK_ID,
          orgId: ORG_ID,
          projectId: PROJECT_ID
        })
      },
      policySet: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: "55555555-5555-5555-5555-555555555555",
            version: 2,
            rules: [
              {
                enabled: true,
                ruleType: "path_prefix_require",
                severity: "warn",
                expression: {
                  prefix: "apps/"
                }
              }
            ]
          })
      },
      guardrailEvaluation: {
        create: vi.fn().mockResolvedValue({
          id: "66666666-6666-6666-6666-666666666666",
          status: "warn"
        })
      }
    } as unknown as PrismaService;

    const guardrailQueue = {
      add: vi.fn().mockResolvedValue(undefined)
    };

    const controller = new GuardrailsController(prisma, guardrailQueue as never);
    const result = await controller.evaluate(
      {
        projectId: PROJECT_ID,
        taskId: TASK_ID,
        stage: "pre_apply",
        changedPaths: ["src/index.ts"]
      },
      USER
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "warn",
        stage: "pre_apply",
        blocking: false,
        reasonCodes: expect.arrayContaining(["required-path-prefix"])
      })
    );
    expect(guardrailQueue.add).toHaveBeenCalledWith(
      "evaluate",
      expect.objectContaining({
        stage: "pre_apply",
        blocking: false
      }),
      expect.any(Object)
    );
  });

  it("returns blocking fail for promote stage", async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: TASK_ID,
          orgId: ORG_ID,
          projectId: PROJECT_ID
        })
      },
      policySet: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: "77777777-7777-7777-7777-777777777777",
            version: 1,
            rules: [
              {
                enabled: true,
                ruleType: "path_prefix_block",
                severity: "fail",
                expression: {
                  prefix: "infra/"
                }
              }
            ]
          })
      },
      guardrailEvaluation: {
        create: vi.fn().mockResolvedValue({
          id: "88888888-8888-8888-8888-888888888888",
          status: "fail"
        })
      }
    } as unknown as PrismaService;

    const controller = new GuardrailsController(
      prisma,
      {
        add: vi.fn()
      } as never
    );

    const result = await controller.evaluate(
      {
        projectId: PROJECT_ID,
        taskId: TASK_ID,
        stage: "promote",
        changedPaths: ["infra/prod.tf"]
      },
      USER
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "fail",
        stage: "promote",
        blocking: true,
        reasonCodes: expect.arrayContaining(["banned-path-prefix"])
      })
    );
  });
});
