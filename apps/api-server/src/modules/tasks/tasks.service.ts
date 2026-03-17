import { createHash } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";

import { resolveProjectPolicy } from "../../common/policy.js";

import { PrismaService } from "../../common/prisma.service.js";

interface CreateTaskInput {
  orgId: string;
  projectId: string;
  repositoryId: string;
  title: string;
  actorUserId: string;
}

interface ListTasksInput {
  projectId?: string;
  status?: "todo" | "in_progress" | "blocked" | "review" | "done" | "archived";
  limit: number;
}

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async createTask(input: CreateTaskInput) {
    return this.prisma.task.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        title: input.title,
        status: "in_progress",
        createdBy: input.actorUserId,
        assignedTo: input.actorUserId,
        startedAt: new Date()
      }
    });
  }

  async getTask(taskId: string) {
    return this.prisma.task.findUnique({
      where: {
        id: taskId
      }
    });
  }

  async getTaskDetails(taskId: string) {
    return this.prisma.task.findUnique({
      where: {
        id: taskId
      },
      include: {
        branches: {
          include: {
            pullRequests: {
              orderBy: {
                createdAt: "desc"
              },
              take: 1
            }
          },
          orderBy: {
            createdAt: "desc"
          },
          take: 3
        },
        qualityGateRuns: {
          orderBy: {
            createdAt: "desc"
          },
          take: 3
        },
        handoffPackets: {
          orderBy: {
            createdAt: "desc"
          },
          take: 3
        }
      }
    });
  }

  async listTasks(input: ListTasksInput) {
    return this.prisma.task.findMany({
      where: {
        projectId: input.projectId,
        status: input.status
      },
      include: {
        branches: {
          orderBy: {
            createdAt: "desc"
          },
          take: 1
        },
        qualityGateRuns: {
          orderBy: {
            createdAt: "desc"
          },
          take: 1
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: input.limit
    });
  }

  async createHandoff(taskId: string, actorUserId: string) {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new NotFoundException("Task not found");
    }

    return this.prisma.handoffPacket.create({
      data: {
        orgId: task.orgId,
        projectId: task.projectId,
        taskId: task.id,
        generatedBy: actorUserId,
        summary: `Handoff generated for task: ${task.title}`,
        constraints: null,
        risks: null,
        nextSteps: null,
        payload: {
          title: task.title,
          status: task.status
        }
      }
    });
  }

  async listPrSlices(taskId: string) {
    return this.prisma.prSlice.findMany({
      where: {
        taskId
      },
      include: {
        pullRequest: {
          include: {
            branch: {
              select: {
                id: true,
                name: true,
                status: true
              }
            }
          }
        }
      },
      orderBy: [
        {
          pullRequestId: "asc"
        },
        {
          sliceOrder: "asc"
        }
      ]
    });
  }

  async buildReviewDigest(taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: {
        id: taskId
      },
      include: {
        branches: {
          include: {
            pullRequests: {
              orderBy: {
                createdAt: "desc"
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    const [
      intentEvents,
      activityEvents,
      conflicts,
      handoffs,
      qualityRuns,
      slices,
      policy
    ] = await Promise.all([
      this.prisma.intentEvent.findMany({
        where: {
          taskId
        },
        orderBy: {
          occurredAt: "asc"
        }
      }),
      this.prisma.activityEvent.findMany({
        where: {
          taskId
        },
        orderBy: {
          occurredAt: "asc"
        }
      }),
      this.prisma.conflictEvent.findMany({
        where: {
          OR: [{ taskId }, { otherTaskId: taskId }]
        },
        orderBy: {
          createdAt: "asc"
        }
      }),
      this.prisma.handoffPacket.findMany({
        where: {
          taskId
        },
        include: {
          acks: true
        },
        orderBy: {
          createdAt: "asc"
        }
      }),
      this.prisma.qualityGateRun.findMany({
        where: {
          taskId
        },
        include: {
          checks: true
        },
        orderBy: {
          createdAt: "desc"
        }
      }),
      this.listPrSlices(taskId),
      resolveProjectPolicy(this.prisma, task.projectId)
    ]);

    const latestQualityRun = qualityRuns[0] ?? null;
    const requiredChecks = policy.requiredQualityChecks ?? [];
    const latestChecksByKey = new Map(
      (latestQualityRun?.checks ?? []).map((check) => [check.checkKey, check.status])
    );
    const missingRequiredChecks = requiredChecks.filter(
      (check) => latestChecksByKey.get(check) !== "passed"
    );
    const failedChecks = (latestQualityRun?.checks ?? [])
      .filter((check) => check.status === "failed")
      .map((check) => check.checkKey)
      .sort((left, right) => left.localeCompare(right));

    const openConflicts = conflicts.filter((conflict) => conflict.resolutionStatus !== "resolved");
    const unresolvedHandoffs = handoffs.filter((handoff) => handoff.acks.length === 0);
    const reasonCodeSet = new Set<string>();
    for (const conflict of openConflicts) {
      for (const reasonCode of conflict.reasonCodes) {
        reasonCodeSet.add(reasonCode);
      }
    }

    const riskPoints =
      Math.min(openConflicts.length, 8) * 8 +
      Math.min(failedChecks.length, 5) * 12 +
      Math.min(missingRequiredChecks.length, 5) * 10 +
      Math.min(unresolvedHandoffs.length, 5) * 6;
    const riskLevel = riskPoints >= 75 ? "high" : riskPoints >= 35 ? "medium" : "low";

    const serializedCore = JSON.stringify({
      taskId: task.id,
      intentEvents: intentEvents.map((event) => ({
        id: event.id,
        eventSeq: event.eventSeq.toString(),
        occurredAt: event.occurredAt.toISOString(),
        eventType: event.eventType
      })),
      activityEvents: activityEvents.map((event) => ({
        id: event.id,
        occurredAt: event.occurredAt.toISOString(),
        eventType: event.eventType
      })),
      conflicts: openConflicts.map((conflict) => ({
        id: conflict.id,
        severity: conflict.severity,
        score: conflict.score.toString(),
        reasonCodes: [...conflict.reasonCodes].sort()
      })),
      quality: latestQualityRun
        ? {
            runId: latestQualityRun.id,
            status: latestQualityRun.status,
            checks: latestQualityRun.checks
              .map((check) => ({
                key: check.checkKey,
                status: check.status
              }))
              .sort((left, right) => left.key.localeCompare(right.key))
          }
        : null,
      handoffs: unresolvedHandoffs.map((handoff) => ({
        id: handoff.id,
        createdAt: handoff.createdAt.toISOString()
      })),
      slices: slices.map((slice) => ({
        id: slice.id,
        pullRequestId: slice.pullRequestId,
        sliceOrder: slice.sliceOrder,
        riskLevel: slice.riskLevel
      }))
    });

    const digestHash = createHash("sha256").update(serializedCore).digest("hex");

    const pullRequests = task.branches
      .flatMap((branch) =>
        branch.pullRequests.map((pr) => ({
          id: pr.id,
          number: pr.number,
          status: pr.status,
          url: pr.url,
          branchName: branch.name
        }))
      )
      .sort((left, right) => left.number - right.number);

    return {
      taskId: task.id,
      generatedAt: new Date().toISOString(),
      digestHash,
      riskLevel,
      reasonCodes: Array.from(reasonCodeSet).sort((left, right) => left.localeCompare(right)),
      recommendedAction:
        riskLevel === "high"
          ? "require_manual_review_before_promote"
          : riskLevel === "medium"
            ? "prioritize_conflict_and_quality_review"
            : "continue_standard_review_flow",
      summary: {
        intentEvents: intentEvents.length,
        activityEvents: activityEvents.length,
        openConflicts: openConflicts.length,
        unresolvedHandoffs: unresolvedHandoffs.length,
        pullRequestCount: pullRequests.length,
        prSliceCount: slices.length,
        latestQualityStatus: latestQualityRun?.status ?? null,
        failedCheckCount: failedChecks.length,
        missingRequiredChecks: missingRequiredChecks.length
      },
      sources: {
        intent: {
          firstEventAt: intentEvents[0]?.occurredAt ?? null,
          lastEventAt: intentEvents[intentEvents.length - 1]?.occurredAt ?? null
        },
        activity: {
          firstSeenAt: activityEvents[0]?.occurredAt ?? null,
          lastSeenAt: activityEvents[activityEvents.length - 1]?.occurredAt ?? null
        },
        quality: {
          latestRunId: latestQualityRun?.id ?? null,
          latestStatus: latestQualityRun?.status ?? null,
          failedChecks,
          requiredChecks,
          missingRequiredChecks
        },
        handoff: {
          count: handoffs.length,
          unresolvedCount: unresolvedHandoffs.length
        },
        conflicts: {
          count: openConflicts.length,
          criticalCount: openConflicts.filter((conflict) => conflict.severity === "critical").length,
          highCount: openConflicts.filter((conflict) => conflict.severity === "high").length
        }
      },
      pullRequests,
      slices: slices.map((slice) => ({
        id: slice.id,
        pullRequestId: slice.pullRequestId,
        pullRequestNumber: slice.pullRequest.number,
        pullRequestStatus: slice.pullRequest.status,
        branchName: slice.pullRequest.branch.name,
        sliceOrder: slice.sliceOrder,
        title: slice.title,
        description: slice.description,
        riskLevel: slice.riskLevel,
        status: slice.status,
        filePaths: slice.filePaths,
        createdAt: slice.createdAt
      }))
    };
  }
}
