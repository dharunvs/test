import { randomUUID } from "node:crypto";

import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { z } from "zod";

import { PrismaService } from "../../common/prisma.service.js";
import { reliableQueueOptions } from "../../common/queue-options.js";
import { Roles } from "../auth/roles.decorator.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";

const runQualityGateSchema = z.object({
  taskId: z.string().uuid(),
  triggerSource: z.string().default("manual"),
  workspacePath: z.string().optional(),
  checkCommands: z
    .object({
      build: z.string().optional(),
      unit_tests: z.string().optional(),
      lint: z.string().optional(),
      dependency_audit: z.string().optional(),
      integration_tests: z.string().optional()
    })
    .optional()
});

const listArtifactsSchema = z.object({
  includeMetadata: z
    .preprocess((value) => {
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(normalized)) {
          return true;
        }
        if (["0", "false", "no", "off"].includes(normalized)) {
          return false;
        }
      }
      return value;
    }, z.boolean())
    .default(false)
});

const listQualityRunsSchema = z.object({
  projectId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50)
});

@Controller("quality-gates")
export class QualityGatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue("queue.quality.run") private readonly qualityQueue: Queue,
    @InjectQueue("queue.pr.slice") private readonly prSliceQueue: Queue,
    @InjectQueue("queue.analytics.rollup") private readonly analyticsQueue: Queue
  ) {}

  @Roles("owner", "admin", "member", "viewer")
  @Get()
  async listRuns(@Query() query: Record<string, unknown>) {
    const input = listQualityRunsSchema.parse(query);

    return this.prisma.qualityGateRun.findMany({
      where: {
        projectId: input.projectId,
        taskId: input.taskId
      },
      include: {
        checks: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: input.limit
    });
  }

  @Roles("owner", "admin", "member")
  @Post("run")
  async run(@Body() body: unknown) {
    const input = runQualityGateSchema.parse(body);

    const task = await this.prisma.task.findUnique({
      where: {
        id: input.taskId
      },
      include: {
        branches: {
          where: {
            status: "active"
          },
          orderBy: {
            createdAt: "desc"
          },
          take: 1
        }
      }
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    const run = await this.prisma.qualityGateRun.create({
      data: {
        orgId: task.orgId,
        projectId: task.projectId,
        taskId: task.id,
        branchId: task.branches[0]?.id,
        triggerSource: input.triggerSource,
        status: "queued",
        summary: {
          requestedAt: new Date().toISOString(),
          executionMode: "commands",
          workspaceRequired: !input.workspacePath,
          workspacePath: input.workspacePath ?? null,
          checkCommands: input.checkCommands ?? {}
        }
      }
    });

    await this.qualityQueue.add("run", {
      runId: run.id,
      taskId: task.id,
      projectId: task.projectId,
      orgId: task.orgId,
      workspacePath: input.workspacePath,
      checkCommands: input.checkCommands
    }, reliableQueueOptions);

    await this.prSliceQueue.add("slice", {
      runId: run.id,
      taskId: task.id,
      projectId: task.projectId,
      orgId: task.orgId
    }, reliableQueueOptions);

    await this.analyticsQueue.add("rollup", {
      orgId: task.orgId,
      projectId: task.projectId,
      taskId: task.id,
      source: "quality_gate_run"
    }, reliableQueueOptions);

    return run;
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get(":id")
  async getRun(@Param("id") id: string) {
    const run = await this.prisma.qualityGateRun.findUnique({
      where: {
        id
      },
      include: {
        checks: true,
        artifacts: {
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });

    if (run && ["passed", "failed", "canceled"].includes(run.status)) {
      this.realtime.emitToProject(run.projectId, "quality_gate.completed", {
        eventId: randomUUID(),
        orgId: run.orgId,
        projectId: run.projectId,
        source: "worker",
        type: "quality_gate.completed",
        timestamp: new Date().toISOString(),
        actor: {
          userId: undefined,
          clientId: undefined
        },
        context: {
          taskId: run.taskId,
          branchId: run.branchId ?? undefined,
          repositoryId: undefined
        },
        payload: {
          runId: run.id,
          status: run.status,
          summary: run.summary
        }
      });
    }

    if (!run) {
      return null;
    }

    const checksSummary = run.checks.reduce(
      (acc, check) => {
        if (check.status === "passed") {
          acc.passed += 1;
        } else if (check.status === "failed") {
          acc.failed += 1;
        } else if (check.status === "canceled") {
          acc.canceled += 1;
        } else if (check.status === "running") {
          acc.running += 1;
        } else {
          acc.queued += 1;
        }
        return acc;
      },
      {
        queued: 0,
        running: 0,
        passed: 0,
        failed: 0,
        canceled: 0
      }
    );

    return {
      ...run,
      artifactCount: run.artifacts.length,
      checksSummary
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get(":id/artifacts")
  async listArtifacts(@Param("id") id: string, @Query() query: Record<string, unknown>) {
    const input = listArtifactsSchema.parse(query);

    const run = await this.prisma.qualityGateRun.findUnique({
      where: {
        id
      },
      select: {
        id: true
      }
    });

    if (!run) {
      throw new NotFoundException("Quality run not found");
    }

    const artifacts = await this.prisma.qualityArtifact.findMany({
      where: {
        runId: id
      },
      include: {
        check: {
          select: {
            id: true,
            checkKey: true,
            status: true
          }
        }
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    return artifacts.map((artifact) => ({
      id: artifact.id,
      runId: artifact.runId,
      checkId: artifact.checkId,
      checkKey: artifact.check?.checkKey ?? null,
      checkStatus: artifact.check?.status ?? null,
      artifactType: artifact.artifactType,
      storageProvider: artifact.storageProvider,
      storageKey: artifact.storageKey,
      contentType: artifact.contentType,
      sizeBytes: artifact.sizeBytes,
      retentionClass: artifact.retentionClass,
      metadata: input.includeMetadata ? artifact.metadata : undefined,
      createdAt: artifact.createdAt
    }));
  }
}
