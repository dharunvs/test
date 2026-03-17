import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { appendAuditLog } from "../../common/audit.js";
import { PrismaService } from "../../common/prisma.service.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";

const inviteSchema = z.object({
  orgId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
  expiresInDays: z.number().int().positive().max(30).default(7)
});

const acceptInviteSchema = z.object({
  inviteId: z.string().uuid()
});

const revokeInviteSchema = z.object({
  inviteId: z.string().uuid()
});

const updateRoleSchema = z.object({
  role: z.enum(["owner", "admin", "member", "viewer"])
});

const createProjectMemberSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["admin", "member", "viewer"])
});

const updateProjectMemberSchema = z.object({
  role: z.enum(["admin", "member", "viewer"]),
  status: z.enum(["active", "inactive"]).default("active")
});

const listProjectMemberSchema = z.object({
  projectId: z.string().uuid()
});

const listOrgMemberSchema = z.object({
  orgId: z.string().uuid(),
  status: z.enum(["active", "invited", "revoked", "expired"]).optional()
});

@Controller("memberships")
export class MembershipsController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles("owner", "admin", "member", "viewer")
  @Get("org-members")
  async listOrgMembers(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const input = listOrgMemberSchema.parse(query);
    await this.assertProjectOrOrgAccess(user.userId, input.orgId);

    return this.prisma.organizationMember.findMany({
      where: {
        orgId: input.orgId,
        status: input.status
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  }

  @Roles("owner", "admin")
  @Post("invite")
  async invite(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = inviteSchema.parse(body);
    await this.assertOrgAdmin(user.userId, input.orgId);

    const invitedUser = await this.prisma.user.upsert({
      where: {
        email: input.email.toLowerCase()
      },
      update: {},
      create: {
        clerkUserId: `invite_${randomUUID()}`,
        email: input.email.toLowerCase(),
        displayName: input.email.split("@")[0] ?? "Invited User"
      }
    });

    const inviteExpiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

    const membership = await this.prisma.organizationMember.upsert({
      where: {
        orgId_userId: {
          orgId: input.orgId,
          userId: invitedUser.id
        }
      },
      update: {
        role: input.role,
        status: "invited",
        invitedBy: user.userId,
        inviteExpiresAt,
        revokedAt: null,
        acceptedAt: null
      },
      create: {
        orgId: input.orgId,
        userId: invitedUser.id,
        role: input.role,
        status: "invited",
        invitedBy: user.userId,
        inviteExpiresAt
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: membership.orgId,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "membership.invite_issued",
      entityType: "organization_member",
      entityId: membership.id,
      payload: {
        email: invitedUser.email,
        role: membership.role,
        inviteExpiresAt: membership.inviteExpiresAt?.toISOString() ?? null
      }
    });

    return {
      inviteId: membership.id,
      orgId: membership.orgId,
      email: invitedUser.email,
      role: membership.role,
      status: membership.status,
      inviteExpiresAt: membership.inviteExpiresAt,
      inviteLink: `https://branchline.dev/invites/${membership.id}`,
      invitedAt: membership.updatedAt
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Post("accept")
  async acceptInvite(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = acceptInviteSchema.parse(body);

    const invite = await this.prisma.organizationMember.findUnique({
      where: {
        id: input.inviteId
      },
      include: {
        user: true
      }
    });

    if (!invite) {
      throw new NotFoundException("Invite not found");
    }

    if (invite.status !== "invited") {
      throw new ForbiddenException("Invite is no longer active");
    }

    if (invite.inviteExpiresAt && invite.inviteExpiresAt.getTime() < Date.now()) {
      await this.prisma.organizationMember.update({
        where: {
          id: invite.id
        },
        data: {
          status: "expired"
        }
      });
      throw new ForbiddenException("Invite has expired");
    }

    if (invite.user.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException("Invite email does not match current account");
    }

    const accepted = await this.prisma.organizationMember.update({
      where: {
        id: invite.id
      },
      data: {
        userId: user.userId,
        status: "active",
        acceptedAt: new Date(),
        joinedAt: new Date(),
        inviteExpiresAt: null
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: accepted.orgId,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "membership.invite_accepted",
      entityType: "organization_member",
      entityId: accepted.id,
      payload: {
        role: accepted.role,
        acceptedAt: accepted.acceptedAt?.toISOString() ?? null
      }
    });

    return {
      id: accepted.id,
      orgId: accepted.orgId,
      role: accepted.role,
      status: accepted.status,
      acceptedAt: accepted.acceptedAt
    };
  }

  @Roles("owner", "admin")
  @Post("revoke")
  async revokeInvite(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = revokeInviteSchema.parse(body);

    const invite = await this.prisma.organizationMember.findUnique({
      where: {
        id: input.inviteId
      }
    });

    if (!invite) {
      throw new NotFoundException("Invite not found");
    }

    await this.assertOrgAdmin(user.userId, invite.orgId);

    const revoked = await this.prisma.organizationMember.update({
      where: {
        id: input.inviteId
      },
      data: {
        status: "revoked",
        revokedAt: new Date()
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: revoked.orgId,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "membership.invite_revoked",
      entityType: "organization_member",
      entityId: revoked.id,
      payload: {
        revokedAt: revoked.revokedAt?.toISOString() ?? null
      }
    });

    return {
      id: revoked.id,
      status: revoked.status,
      revokedAt: revoked.revokedAt
    };
  }

  @Roles("owner", "admin")
  @Patch(":id/role")
  async updateOrgRole(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = updateRoleSchema.parse(body);

    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        id
      }
    });

    if (!membership) {
      throw new NotFoundException("Membership not found");
    }

    await this.assertOrgAdmin(user.userId, membership.orgId);

    if (membership.userId === user.userId && !["owner", "admin"].includes(input.role)) {
      throw new ForbiddenException("Role change would remove your administrative access");
    }

    if (membership.role === "owner" && input.role !== "owner") {
      const ownerCount = await this.prisma.organizationMember.count({
        where: {
          orgId: membership.orgId,
          role: "owner",
          status: "active"
        }
      });

      if (ownerCount <= 1) {
        throw new ForbiddenException("Cannot remove the last owner from this organization");
      }
    }

    const updated = await this.prisma.organizationMember.update({
      where: {
        id
      },
      data: {
        role: input.role
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: updated.orgId,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "membership.role_updated",
      entityType: "organization_member",
      entityId: updated.id,
      payload: {
        role: updated.role
      }
    });

    return {
      id: updated.id,
      orgId: updated.orgId,
      role: updated.role,
      status: updated.status
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get("project-members")
  async listProjectMembers(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const input = listProjectMemberSchema.parse(query);
    await this.assertProjectAccess(user.userId, input.projectId, "viewer");

    return this.prisma.projectMember.findMany({
      where: {
        projectId: input.projectId,
        status: "active"
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  }

  @Roles("owner", "admin")
  @Post("project-members")
  async addProjectMember(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = createProjectMemberSchema.parse(body);
    const project = await this.getProjectOrThrow(input.projectId);
    await this.assertProjectAccess(user.userId, input.projectId, "admin");

    const member = await this.prisma.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId: input.projectId,
          userId: input.userId
        }
      },
      update: {
        role: input.role,
        status: "active"
      },
      create: {
        projectId: input.projectId,
        userId: input.userId,
        role: input.role,
        status: "active"
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project_member.added",
      entityType: "project_member",
      entityId: member.id,
      payload: {
        userId: member.userId,
        role: member.role
      }
    });

    return member;
  }

  @Roles("owner", "admin")
  @Patch("project-members/:id")
  async updateProjectMember(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = updateProjectMemberSchema.parse(body);

    const member = await this.prisma.projectMember.findUnique({
      where: {
        id
      }
    });

    if (!member) {
      throw new NotFoundException("Project member not found");
    }

    await this.assertProjectAccess(user.userId, member.projectId, "admin");
    const project = await this.getProjectOrThrow(member.projectId);

    const updated = await this.prisma.projectMember.update({
      where: {
        id
      },
      data: {
        role: input.role,
        status: input.status
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project_member.updated",
      entityType: "project_member",
      entityId: updated.id,
      payload: {
        role: updated.role,
        status: updated.status
      }
    });

    return updated;
  }

  @Roles("owner", "admin")
  @Delete("project-members/:id")
  async removeProjectMember(@Param("id") id: string, @CurrentUser() user: AuthContext) {
    const member = await this.prisma.projectMember.findUnique({
      where: {
        id
      }
    });

    if (!member) {
      throw new NotFoundException("Project member not found");
    }

    await this.assertProjectAccess(user.userId, member.projectId, "admin");
    const project = await this.getProjectOrThrow(member.projectId);

    const removed = await this.prisma.projectMember.update({
      where: {
        id
      },
      data: {
        status: "inactive"
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project_member.removed",
      entityType: "project_member",
      entityId: removed.id,
      payload: {
        userId: removed.userId
      }
    });

    return {
      ok: true,
      id
    };
  }

  private async getProjectOrThrow(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: {
        id: projectId
      },
      select: {
        id: true,
        orgId: true
      }
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    return project;
  }

  private async assertOrgAdmin(userId: string, orgId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        orgId,
        userId,
        status: "active",
        role: {
          in: ["owner", "admin"]
        }
      }
    });

    if (!membership) {
      throw new ForbiddenException("Insufficient organization permissions");
    }
  }

  private async assertProjectOrOrgAccess(userId: string, orgId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        orgId,
        userId,
        status: {
          in: ["active", "invited"]
        }
      },
      select: {
        id: true
      }
    });

    if (!membership) {
      throw new ForbiddenException("User is not an active organization member");
    }
  }

  private async assertProjectAccess(userId: string, projectId: string, mode: "viewer" | "admin") {
    const project = await this.getProjectOrThrow(projectId);

    const [orgMembership, projectMembership] = await Promise.all([
      this.prisma.organizationMember.findFirst({
        where: {
          orgId: project.orgId,
          userId,
          status: "active"
        },
        select: {
          role: true
        }
      }),
      this.prisma.projectMember.findFirst({
        where: {
          projectId: project.id,
          userId,
          status: "active"
        },
        select: {
          role: true
        }
      })
    ]);

    if (!orgMembership) {
      throw new ForbiddenException("User is not an active member of this organization");
    }

    const isOrgAdmin = orgMembership.role === "owner" || orgMembership.role === "admin";
    const isProjectAdmin = projectMembership?.role === "admin";

    if (mode === "admin") {
      if (!isOrgAdmin && !isProjectAdmin) {
        throw new ForbiddenException("Insufficient project admin permissions");
      }
      return;
    }

    if (!isOrgAdmin && !projectMembership) {
      throw new ForbiddenException("User is not an active member of this project");
    }
  }
}
