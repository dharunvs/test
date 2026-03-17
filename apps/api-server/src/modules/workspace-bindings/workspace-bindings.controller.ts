import { Body, Controller, Post } from "@nestjs/common";
import { z } from "zod";

import { PrismaService } from "../../common/prisma.service.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";

const bindSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  workspaceHash: z.string().min(6),
  extensionVersion: z.string().default("0.1.0"),
  vscodeVersion: z.string().optional(),
  os: z.string().optional()
});

const validateSchema = z.object({
  projectId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  workspaceHash: z.string().min(6).optional()
});

@Controller("workspaces")
export class WorkspaceBindingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles("owner", "admin", "member")
  @Post("bind")
  async bind(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = bindSchema.parse(body);

    const extensionClient = await this.prisma.extensionClient.create({
      data: {
        orgId: input.orgId,
        userId: user.userId,
        machineFingerprint: input.workspaceHash,
        extensionVersion: input.extensionVersion,
        vscodeVersion: input.vscodeVersion,
        os: input.os,
        lastSeenAt: new Date()
      }
    });

    const binding = await this.prisma.workspaceBinding.upsert({
      where: {
        userId_workspaceHash: {
          userId: user.userId,
          workspaceHash: input.workspaceHash
        }
      },
      update: {
        orgId: input.orgId,
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        extensionClientId: extensionClient.id,
        lastBoundAt: new Date()
      },
      create: {
        orgId: input.orgId,
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        userId: user.userId,
        extensionClientId: extensionClient.id,
        workspaceHash: input.workspaceHash,
        lastBoundAt: new Date()
      }
    });

    return {
      id: binding.id,
      orgId: binding.orgId,
      projectId: binding.projectId,
      repositoryId: binding.repositoryId,
      workspaceHash: binding.workspaceHash,
      lastBoundAt: binding.lastBoundAt
    };
  }

  @Roles("owner", "admin", "member")
  @Post("validate")
  async validate(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = validateSchema.parse(body);

    const mapping = await this.prisma.projectRepository.findFirst({
      where: {
        projectId: input.projectId,
        repositoryId: input.repositoryId
      }
    });

    if (!mapping) {
      return {
        valid: false
      };
    }

    if (!input.workspaceHash) {
      return {
        valid: true
      };
    }

    const binding = await this.prisma.workspaceBinding.findUnique({
      where: {
        userId_workspaceHash: {
          userId: user.userId,
          workspaceHash: input.workspaceHash
        }
      },
      select: {
        projectId: true,
        repositoryId: true
      }
    });

    return {
      valid: Boolean(
        binding &&
          binding.projectId === input.projectId &&
          binding.repositoryId === input.repositoryId
      )
    };
  }
}
