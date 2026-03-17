import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import type { AuthContext } from "../src/modules/auth/auth.types.js";
import { PromptLibraryController } from "../src/modules/prompt-library/prompt-library.controller.js";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const TEMPLATE_ID = "22222222-2222-2222-2222-222222222222";
const USER = {
  userId: "33333333-3333-3333-3333-333333333333",
  clerkUserId: "clerk-user-1",
  email: "owner@branchline.dev",
  role: "owner"
} satisfies AuthContext;

describe("PromptLibraryController", () => {
  it("returns template_not_found when creating a version for unknown template", async () => {
    const prisma = {
      promptTemplate: {
        findUnique: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaService;

    const controller = new PromptLibraryController(prisma);
    const result = await controller.createVersion(
      TEMPLATE_ID,
      {
        content: "Refined prompt content",
        variables: {
          ticket: "ABC-123"
        }
      },
      USER
    );

    expect(result).toEqual({
      created: false,
      reason: "template_not_found"
    });
  });

  it("creates next template version using latest version number", async () => {
    const prisma = {
      promptTemplate: {
        findUnique: vi.fn().mockResolvedValue({
          id: TEMPLATE_ID
        })
      },
      promptTemplateVersion: {
        findFirst: vi.fn().mockResolvedValue({
          version: 2
        }),
        create: vi.fn().mockResolvedValue({
          id: "44444444-4444-4444-4444-444444444444",
          version: 3
        })
      }
    } as unknown as PrismaService;

    const controller = new PromptLibraryController(prisma);
    const result = await controller.createVersion(
      TEMPLATE_ID,
      {
        content: "Refined prompt content",
        variables: {
          ticket: "ABC-123"
        },
        changelog: "Added merge checklist"
      },
      USER
    );

    expect(result).toEqual({
      created: true,
      templateId: TEMPLATE_ID,
      versionId: "44444444-4444-4444-4444-444444444444",
      version: 3
    });
  });

  it("aggregates usage analytics by template and version", async () => {
    const prisma = {
      promptUsage: {
        findMany: vi.fn().mockResolvedValue([
          {
            template: {
              id: TEMPLATE_ID,
              name: "PR Digest",
              slug: "pr-digest"
            },
            templateVersion: {
              id: "ver-1",
              version: 2
            },
            successRating: 4
          },
          {
            template: {
              id: TEMPLATE_ID,
              name: "PR Digest",
              slug: "pr-digest"
            },
            templateVersion: {
              id: "ver-2",
              version: 2
            },
            successRating: 5
          },
          {
            template: {
              id: TEMPLATE_ID,
              name: "PR Digest",
              slug: "pr-digest"
            },
            templateVersion: {
              id: "ver-3",
              version: 3
            },
            successRating: null
          }
        ])
      }
    } as unknown as PrismaService;

    const controller = new PromptLibraryController(prisma);
    const result = await controller.usageAnalytics({
      orgId: ORG_ID,
      sinceDays: "30"
    });

    expect(result.totalUsage).toBe(3);
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0]).toEqual({
      templateId: TEMPLATE_ID,
      name: "PR Digest",
      slug: "pr-digest",
      usageCount: 3,
      averageRating: 4.5,
      versions: {
        v2: 2,
        v3: 1
      }
    });
  });
});
