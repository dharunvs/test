import { Body, Controller, Get, NotFoundException, Param, Post, Put } from "@nestjs/common";
import { z } from "zod";

import { appendAuditLog } from "../../common/audit.js";
import { resolveProjectPolicy, upsertProjectPolicy } from "../../common/policy.js";
import { PrismaService } from "../../common/prisma.service.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";

const createProjectSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(2),
  key: z.string().min(2),
  baseBranch: z.string().default("main")
});

const policySchema = z.object({
  baseBranch: z.string().optional(),
  protectedBranches: z.array(z.string()).optional(),
  autoPush: z.boolean().optional(),
  autoPr: z.boolean().optional(),
  staleThresholdMinutes: z.number().int().positive().optional(),
  cleanupAfterMergeHours: z.number().int().positive().optional(),
  requiredQualityChecks: z
    .array(
      z.enum(["build", "unit_tests", "lint", "dependency_audit", "integration_tests"])
    )
    .optional(),
  enforceGuardrailRecheckOnPromote: z.boolean().optional()
});

@Controller("projects")
export class ProjectsController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles("owner", "admin", "member", "viewer")
  @Get(":orgId")
  async listByOrg(@Param("orgId") orgId: string, @CurrentUser() user: AuthContext) {
    const projects = await this.prisma.project.findMany({
      where: {
        orgId,
        organization: {
          members: {
            some: {
              userId: user.userId,
              status: {
                in: ["active", "invited"]
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return projects.map((project) => ({
      id: project.id,
      orgId: project.orgId,
      name: project.name,
      key: project.key,
      defaultBaseBranch: project.defaultBaseBranch
    }));
  }

  @Roles("owner", "admin", "member")
  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = createProjectSchema.parse(body);

    const project = await this.prisma.project.create({
      data: {
        orgId: input.orgId,
        name: input.name,
        key: input.key,
        defaultBaseBranch: input.baseBranch,
        settings: {},
        createdBy: user.userId
      }
    });

    await this.prisma.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId: project.id,
          userId: user.userId
        }
      },
      update: {
        role: "admin",
        status: "active"
      },
      create: {
        projectId: project.id,
        userId: user.userId,
        role: "admin",
        status: "active"
      }
    });

    await upsertProjectPolicy({
      prisma: this.prisma,
      projectId: project.id,
      orgId: project.orgId,
      actorUserId: user.userId,
      partial: {
        baseBranch: input.baseBranch
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project.created",
      entityType: "project",
      entityId: project.id,
      payload: {
        name: project.name,
        key: project.key
      }
    });

    return {
      id: project.id,
      orgId: project.orgId,
      name: project.name,
      key: project.key,
      defaultBaseBranch: project.defaultBaseBranch,
      createdAt: project.createdAt
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get(":projectId/policy")
  async getPolicy(@Param("projectId") projectId: string) {
    return resolveProjectPolicy(this.prisma, projectId);
  }

  @Roles("owner", "admin")
  @Put(":projectId/policy")
  async updatePolicy(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthContext
  ) {
    const partialPolicy = policySchema.parse(body);

    const project = await this.prisma.project.findUnique({
      where: {
        id: projectId
      }
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    const policy = await upsertProjectPolicy({
      prisma: this.prisma,
      projectId,
      orgId: project.orgId,
      actorUserId: user.userId,
      partial: partialPolicy
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project.policy.updated",
      entityType: "project",
      entityId: project.id,
      payload: policy
    });

    return policy;
  }
}
