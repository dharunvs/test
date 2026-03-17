import { randomUUID } from "node:crypto";

import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { z } from "zod";

import { PrismaService } from "../../common/prisma.service.js";
import { reliableQueueOptions } from "../../common/queue-options.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";

const conflictScoreSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  taskId: z.string().uuid(),
  otherTaskId: z.string().uuid().optional(),
  overlappingFiles: z.array(z.string()),
  overlappingSymbols: z.array(z.string()).default([]),
  guardrailBoundaryOverlap: z.number().min(0).max(100).default(0),
  overlapDensity: z.number().min(0).max(100).default(0),
  branchDivergenceCommits: z.number().int().min(0).default(0),
  staleMinutes: z.number().int().min(0).default(0),
  ownershipClaimsActive: z.number().int().min(0).default(0)
});

const claimSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
  scopeType: z.string().default("file"),
  scopeValue: z.string(),
  ttlMinutes: z.number().int().positive().default(120)
});

const claimQuerySchema = z.object({
  projectId: z.string().uuid(),
  scopeType: z.string().optional(),
  scopeValue: z.string().optional()
});

const listConflictsSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  resolutionStatus: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(100)
});

@Controller("conflicts")
export class ConflictsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue("queue.conflict.score") private readonly conflictQueue: Queue
  ) {}

  @Roles("owner", "admin", "member")
  @Post("score")
  async score(@Body() body: unknown) {
    const input = conflictScoreSchema.parse(body);
    const scoreBreakdown = {
      fileOverlap: input.overlappingFiles.length * 15,
      symbolOverlap: input.overlappingSymbols.length * 10,
      guardrailBoundary: Math.round(input.guardrailBoundaryOverlap * 0.5),
      overlapDensity: Math.round(input.overlapDensity * 0.2),
      divergence: Math.min(20, input.branchDivergenceCommits * 2),
      staleness: Math.min(15, Math.round(input.staleMinutes / 30)),
      ownershipPressure: Math.min(15, input.ownershipClaimsActive * 5)
    };
    const score = Math.min(
      100,
      scoreBreakdown.fileOverlap +
        scoreBreakdown.symbolOverlap +
        scoreBreakdown.guardrailBoundary +
        scoreBreakdown.overlapDensity +
        scoreBreakdown.divergence +
        scoreBreakdown.staleness +
        scoreBreakdown.ownershipPressure
    );
    const severity = score >= 80 ? "critical" : score >= 60 ? "high" : score >= 30 ? "medium" : "low";

    const reasonCodes = ["file_overlap"];
    if (input.overlappingSymbols.length > 0) {
      reasonCodes.push("symbol_overlap");
    }
    if (input.guardrailBoundaryOverlap > 0) {
      reasonCodes.push("guardrail_overlap");
    }
    if (input.overlapDensity > 0) {
      reasonCodes.push("dense_change_overlap");
    }
    if (input.branchDivergenceCommits > 0) {
      reasonCodes.push("branch_divergence");
    }
    if (input.staleMinutes > 0) {
      reasonCodes.push("stale_activity_overlap");
    }
    if (input.ownershipClaimsActive > 0) {
      reasonCodes.push("ownership_claim_overlap");
    }

    const conflict = await this.prisma.conflictEvent.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        taskId: input.taskId,
        otherTaskId: input.otherTaskId,
        severity,
        score,
        reasonCodes,
        filePaths: input.overlappingFiles,
        symbolNames: input.overlappingSymbols,
        resolutionStatus: "open"
      }
    });

    await this.conflictQueue.add("score", {
      conflictId: conflict.id,
      projectId: input.projectId,
      taskId: input.taskId
    }, reliableQueueOptions);

    this.realtime.emitToProject(input.projectId, "conflict.detected", {
      eventId: randomUUID(),
      orgId: input.orgId,
      projectId: input.projectId,
      source: "worker",
      type: "conflict.detected",
      timestamp: new Date().toISOString(),
      actor: {
        userId: undefined,
        clientId: undefined
      },
      context: {
        taskId: input.taskId,
        branchId: undefined,
        repositoryId: input.repositoryId
      },
      payload: {
        conflictId: conflict.id,
        severity,
        score,
        reasonCodes,
        scoreBreakdown,
        filePaths: input.overlappingFiles,
        symbolNames: input.overlappingSymbols,
        suggestedAction:
          severity === "high" || severity === "critical"
            ? "split_work_or_rebase_before_merge"
            : "continue_with_watch"
      }
    });

    return {
      taskId: input.taskId,
      otherTaskId: input.otherTaskId,
      score,
      severity,
      reasonCodes,
      scoreBreakdown,
      suggestedAction:
        severity === "high" || severity === "critical"
          ? "split_work_or_rebase_before_merge"
          : "continue_with_watch",
      conflictId: conflict.id
    };
  }

  @Roles("owner", "admin", "member")
  @Post("claims")
  async claim(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = claimSchema.parse(body);

    const expiresAt = new Date(Date.now() + input.ttlMinutes * 60 * 1000);

    const claim = await this.prisma.ownershipClaim.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        taskId: input.taskId,
        userId: user.userId,
        scopeType: input.scopeType,
        scopeValue: input.scopeValue,
        expiresAt
      }
    });

    return {
      id: claim.id,
      scopeType: claim.scopeType,
      scopeValue: claim.scopeValue,
      expiresAt: claim.expiresAt
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const input = listConflictsSchema.parse(query);

    const where = {
      projectId: input.projectId,
      resolutionStatus: input.resolutionStatus,
      ...(input.taskId
        ? {
            OR: [{ taskId: input.taskId }, { otherTaskId: input.taskId }]
          }
        : {})
    } as const;

    return this.prisma.conflictEvent.findMany({
      where,
      orderBy: {
        createdAt: "desc"
      },
      take: input.limit
    });
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get("claims")
  async listClaims(@Query() query: Record<string, unknown>) {
    const input = claimQuerySchema.parse(query);

    return this.prisma.ownershipClaim.findMany({
      where: {
        projectId: input.projectId,
        scopeType: input.scopeType,
        scopeValue: input.scopeValue,
        releasedAt: null,
        expiresAt: {
          gt: new Date()
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  }
}
