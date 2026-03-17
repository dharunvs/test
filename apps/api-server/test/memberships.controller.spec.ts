import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { MembershipsController } from "../src/modules/memberships/memberships.controller.js";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const INVITE_ID = "33333333-3333-3333-3333-333333333333";
const USER_ID = "44444444-4444-4444-4444-444444444444";

describe("MembershipsController authorization", () => {
  it("blocks invite revocation when caller is not admin in invite org", async () => {
    const prisma = {
      organizationMember: {
        findUnique: vi.fn().mockResolvedValue({
          id: INVITE_ID,
          orgId: ORG_ID,
          status: "invited"
        }),
        findFirst: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaService;

    const controller = new MembershipsController(prisma);

    await expect(
      controller.revokeInvite(
        {
          inviteId: INVITE_ID
        },
        {
          userId: USER_ID,
          clerkUserId: "clerk",
          email: "user@branchline.dev",
          role: "admin"
        }
      )
    ).rejects.toThrow(ForbiddenException);
  });

  it("blocks project-member listing for users not assigned to that project", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: PROJECT_ID,
          orgId: ORG_ID
        })
      },
      organizationMember: {
        findFirst: vi.fn().mockResolvedValue({
          role: "member"
        })
      },
      projectMember: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn()
      }
    } as unknown as PrismaService;

    const controller = new MembershipsController(prisma);

    await expect(
      controller.listProjectMembers(
        {
          projectId: PROJECT_ID
        },
        {
          userId: USER_ID,
          clerkUserId: "clerk",
          email: "user@branchline.dev",
          role: "member"
        }
      )
    ).rejects.toThrow(ForbiddenException);
  });

  it("blocks demoting the last owner in an organization", async () => {
    const prisma = {
      organizationMember: {
        findUnique: vi.fn().mockResolvedValue({
          id: INVITE_ID,
          orgId: ORG_ID,
          userId: USER_ID,
          role: "owner",
          status: "active"
        }),
        findFirst: vi.fn().mockResolvedValue({
          id: "admin-membership",
          orgId: ORG_ID,
          userId: USER_ID,
          role: "owner",
          status: "active"
        }),
        count: vi.fn().mockResolvedValue(1),
        update: vi.fn()
      }
    } as unknown as PrismaService;

    const controller = new MembershipsController(prisma);

    await expect(
      controller.updateOrgRole(
        INVITE_ID,
        {
          role: "admin"
        },
        {
          userId: USER_ID,
          clerkUserId: "clerk",
          email: "owner@branchline.dev",
          role: "owner"
        }
      )
    ).rejects.toThrow(ForbiddenException);
  });
});
