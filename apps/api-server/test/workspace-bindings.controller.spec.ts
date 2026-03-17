import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { WorkspaceBindingsController } from "../src/modules/workspace-bindings/workspace-bindings.controller.js";

const USER = {
  userId: "11111111-1111-1111-1111-111111111111",
  clerkUserId: "clerk_1",
  email: "dev@branchline.dev",
  role: "member" as const
};

describe("WorkspaceBindingsController validate", () => {
  it("returns false when workspace hash is not bound to current user", async () => {
    const prisma = {
      projectRepository: {
        findFirst: vi.fn().mockResolvedValue({
          id: "mapping"
        })
      },
      workspaceBinding: {
        findUnique: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaService;

    const controller = new WorkspaceBindingsController(prisma);
    const result = await controller.validate(
      {
        projectId: "22222222-2222-2222-2222-222222222222",
        repositoryId: "33333333-3333-3333-3333-333333333333",
        workspaceHash: "hash_abc123"
      },
      USER
    );

    expect(result.valid).toBe(false);
  });

  it("returns true when mapping and workspace ownership both match", async () => {
    const prisma = {
      projectRepository: {
        findFirst: vi.fn().mockResolvedValue({
          id: "mapping"
        })
      },
      workspaceBinding: {
        findUnique: vi.fn().mockResolvedValue({
          projectId: "22222222-2222-2222-2222-222222222222",
          repositoryId: "33333333-3333-3333-3333-333333333333"
        })
      }
    } as unknown as PrismaService;

    const controller = new WorkspaceBindingsController(prisma);
    const result = await controller.validate(
      {
        projectId: "22222222-2222-2222-2222-222222222222",
        repositoryId: "33333333-3333-3333-3333-333333333333",
        workspaceHash: "hash_abc123"
      },
      USER
    );

    expect(result.valid).toBe(true);
  });
});

