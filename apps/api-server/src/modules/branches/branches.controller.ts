import { randomUUID } from "node:crypto";

import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";

import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { PrismaService } from "../../common/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { BranchesService } from "./branches.service.js";

const createBranchSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
  ticketOrTask: z.string().min(1),
  taskSlug: z.string().min(1),
  currentBranch: z.string().min(1)
});

const policySweepSchema = z.object({
  projectId: z.string().uuid()
});

const ensurePrSchema = z.object({
  title: z.string().min(2).optional(),
  body: z.string().optional(),
  draft: z.boolean().default(true)
});

const promoteSchema = z.object({
  requireOpenPr: z.boolean().default(true),
  dryRun: z.boolean().default(false)
});

const mergeSchema = z.object({
  strategy: z.enum(["squash", "merge", "rebase"]).default("squash"),
  requireOpenPr: z.boolean().default(true),
  openDraftIfNeeded: z.boolean().default(true)
});

@Controller("branches")
export class BranchesController {
  constructor(
    private readonly branchesService: BranchesService,
    private readonly realtime: RealtimeGateway,
    private readonly prisma: PrismaService
  ) {}

  @Roles("owner", "admin", "member")
  @Post("create")
  async create(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = createBranchSchema.parse(body);
    const created = await this.branchesService.createBranch({
      ...input,
      actorUserId: user.userId
    });

    if (!created.blocked && created.branch) {
      this.realtime.emitToProject(input.projectId, "branch.status_changed", {
        eventId: randomUUID(),
        orgId: created.branch.orgId,
        projectId: input.projectId,
        source: "worker",
        type: "branch.status_changed",
        timestamp: new Date().toISOString(),
        actor: {
          userId: user.userId,
          clientId: undefined
        },
        context: {
          taskId: input.taskId,
          branchId: created.branch.id,
          repositoryId: created.branch.repositoryId
        },
        payload: {
          status: created.branch.status,
          branchName: created.branch.name,
          pullRequestId: created.pullRequest?.id
        }
      });
    }

    return created;
  }

  @Roles("owner", "admin", "member")
  @Post(":id/sync")
  async sync(@Param("id") id: string, @CurrentUser() user: AuthContext) {
    const branch = await this.prisma.branch.findUnique({
      where: {
        id
      }
    });

    if (branch) {
      this.realtime.emitToProject(branch.projectId, "branch.status_changed", {
        eventId: randomUUID(),
        orgId: branch.orgId,
        projectId: branch.projectId,
        source: "worker",
        type: "branch.status_changed",
        timestamp: new Date().toISOString(),
        actor: {
          userId: user.userId,
          clientId: undefined
        },
        context: {
          taskId: branch.taskId,
          branchId: branch.id,
          repositoryId: branch.repositoryId
        },
        payload: {
          status: "synced"
        }
      });
    }

    return {
      ok: true,
      syncedAt: new Date().toISOString()
    };
  }

  @Roles("owner", "admin", "member")
  @Post(":id/ensure-pr")
  async ensurePr(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = ensurePrSchema.parse(body ?? {});

    const ensured = await this.branchesService.ensurePullRequest({
      branchId: id,
      actorUserId: user.userId,
      title: input.title,
      body: input.body,
      draft: input.draft
    });

    if (ensured.pullRequest) {
      this.realtime.emitToProject(ensured.projectId, "branch.status_changed", {
        eventId: randomUUID(),
        orgId: ensured.orgId,
        projectId: ensured.projectId,
        source: "worker",
        type: "branch.status_changed",
        timestamp: new Date().toISOString(),
        actor: {
          userId: user.userId,
          clientId: undefined
        },
        context: {
          taskId: ensured.taskId,
          branchId: id,
          repositoryId: ensured.repositoryId
        },
        payload: {
          status: ensured.pullRequest.status,
          pullRequestId: ensured.pullRequest.id,
          pullRequestNumber: ensured.pullRequest.number,
          providerMode: ensured.providerMode
        }
      });
    }

    return ensured;
  }

  @Roles("owner", "admin", "member")
  @Post(":id/promote")
  async promote(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = promoteSchema.parse(body ?? {});
    const result = await this.branchesService.promoteBranch({
      branchId: id,
      actorUserId: user.userId,
      requireOpenPr: input.requireOpenPr,
      dryRun: input.dryRun
    });

    if (result.promoted) {
      this.realtime.emitToProject(result.projectId, "branch.status_changed", {
        eventId: randomUUID(),
        orgId: result.orgId,
        projectId: result.projectId,
        source: "worker",
        type: "branch.status_changed",
        timestamp: new Date().toISOString(),
        actor: {
          userId: user.userId,
          clientId: undefined
        },
        context: {
          taskId: result.taskId,
          branchId: result.branchId,
          repositoryId: undefined
        },
        payload: {
          status: input.dryRun ? "promotable" : "promoted",
          qualityRunId: result.qualityRunId,
          guardrailStatus: result.guardrailStatus,
          pullRequestNumber: result.pullRequest?.number
        }
      });
    }

    return result;
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get(":id/automation-status")
  async automationStatus(@Param("id") id: string) {
    return this.branchesService.getBranchAutomationStatus(id);
  }

  @Roles("owner", "admin", "member")
  @Post(":id/merge")
  async merge(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = mergeSchema.parse(body ?? {});
    const result = await this.branchesService.mergeBranch({
      branchId: id,
      actorUserId: user.userId,
      strategy: input.strategy,
      requireOpenPr: input.requireOpenPr,
      openDraftIfNeeded: input.openDraftIfNeeded
    });

    if (result.merged) {
      this.realtime.emitToProject(result.projectId, "branch.status_changed", {
        eventId: randomUUID(),
        orgId: result.orgId,
        projectId: result.projectId,
        source: "worker",
        type: "branch.status_changed",
        timestamp: new Date().toISOString(),
        actor: {
          userId: user.userId,
          clientId: undefined
        },
        context: {
          taskId: result.taskId,
          branchId: result.branchId,
          repositoryId: undefined
        },
        payload: {
          status: "merged",
          pullRequestNumber: result.pullRequest?.number
        }
      });
    }

    return result;
  }

  @Roles("owner", "admin", "member")
  @Post("stale-scan")
  async staleScan(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = policySweepSchema.parse(body);
    const result = await this.branchesService.markStaleBranches({
      projectId: input.projectId,
      actorUserId: user.userId
    });

    return {
      ok: true,
      ...result,
      scannedAt: new Date().toISOString()
    };
  }

  @Roles("owner", "admin", "member")
  @Post("cleanup-merged")
  async cleanupMerged(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = policySweepSchema.parse(body);
    const result = await this.branchesService.cleanupMergedBranches({
      projectId: input.projectId,
      actorUserId: user.userId
    });

    return {
      ok: true,
      ...result,
      cleanedAt: new Date().toISOString()
    };
  }
}
