import { BadRequestException, Controller, Get, NotFoundException, Query } from "@nestjs/common";
import { z } from "zod";

import { PrismaService } from "../../common/prisma.service.js";
import { Roles } from "../auth/roles.decorator.js";

const graphQuerySchema = z.object({
  taskId: z.string().uuid(),
  includePayload: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().positive().max(500).default(200)
});

type GraphNode = {
  id: string;
  type: string;
  label: string;
  timestamp?: string;
  data?: Record<string, unknown>;
};

type GraphEdge = {
  from: string;
  to: string;
  type: string;
};

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseCommitLink(rationale: string | null | undefined): { commitSha?: string; runId?: string; intentId?: string } {
  if (!rationale) {
    return {};
  }

  try {
    const parsed = JSON.parse(rationale) as Record<string, unknown>;
    return {
      commitSha: typeof parsed.commitSha === "string" ? parsed.commitSha : undefined,
      runId: typeof parsed.runId === "string" ? parsed.runId : undefined,
      intentId: typeof parsed.intentId === "string" ? parsed.intentId : undefined
    };
  } catch {
    return {};
  }
}

@Controller("provenance")
export class ProvenanceController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles("owner", "admin", "member", "viewer")
  @Get("graph")
  async graph(@Query() query: Record<string, unknown>) {
    const input = graphQuerySchema.parse(query);

    const task = await this.prisma.task.findUnique({
      where: {
        id: input.taskId
      }
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    const [
      branches,
      intentEvents,
      taskDecisions,
      aiRuns,
      qualityRuns,
      handoffs,
      conflicts,
      promptUsages,
      replaySnapshots
    ] = await Promise.all([
      this.prisma.branch.findMany({
        where: {
          taskId: task.id
        },
        include: {
          pullRequests: true
        },
        orderBy: {
          createdAt: "asc"
        },
        take: input.limit
      }),
      this.prisma.intentEvent.findMany({
        where: {
          taskId: task.id
        },
        orderBy: {
          eventSeq: "asc"
        },
        take: input.limit
      }),
      this.prisma.taskDecision.findMany({
        where: {
          taskId: task.id
        },
        orderBy: {
          createdAt: "asc"
        },
        take: input.limit
      }),
      this.prisma.aiRun.findMany({
        where: {
          taskId: task.id
        },
        orderBy: {
          startedAt: "asc"
        },
        take: input.limit
      }),
      this.prisma.qualityGateRun.findMany({
        where: {
          taskId: task.id
        },
        include: {
          checks: true,
          artifacts: true
        },
        orderBy: {
          createdAt: "asc"
        },
        take: input.limit
      }),
      this.prisma.handoffPacket.findMany({
        where: {
          taskId: task.id
        },
        include: {
          acks: true
        },
        orderBy: {
          createdAt: "asc"
        },
        take: input.limit
      }),
      this.prisma.conflictEvent.findMany({
        where: {
          OR: [{ taskId: task.id }, { otherTaskId: task.id }]
        },
        orderBy: {
          createdAt: "asc"
        },
        take: input.limit
      }),
      this.prisma.promptUsage.findMany({
        where: {
          taskId: task.id
        },
        orderBy: {
          createdAt: "asc"
        },
        take: input.limit
      }),
      this.prisma.replaySnapshot.findMany({
        where: {
          taskId: task.id
        },
        orderBy: {
          snapshotVersion: "asc"
        },
        take: input.limit
      })
    ]);

    const nodeMap = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    const addNode = (node: GraphNode) => {
      if (!node.id) {
        throw new BadRequestException("Invalid provenance node id");
      }

      if (!nodeMap.has(node.id)) {
        nodeMap.set(node.id, node);
      }
    };

    const addEdge = (edge: GraphEdge) => {
      edges.push(edge);
    };

    const taskNodeId = `task:${task.id}`;
    addNode({
      id: taskNodeId,
      type: "task",
      label: task.title,
      timestamp: task.createdAt.toISOString(),
      data: {
        status: task.status,
        repositoryId: task.repositoryId,
        projectId: task.projectId,
        orgId: task.orgId
      }
    });

    for (const branch of branches) {
      const branchNodeId = `branch:${branch.id}`;
      addNode({
        id: branchNodeId,
        type: "branch",
        label: branch.name,
        timestamp: branch.createdAt.toISOString(),
        data: {
          status: branch.status,
          baseBranch: branch.baseBranch,
          headSha: branch.headSha ?? null
        }
      });
      addEdge({ from: taskNodeId, to: branchNodeId, type: "task_branch" });

      for (const pullRequest of branch.pullRequests) {
        const prNodeId = `pr:${pullRequest.id}`;
        addNode({
          id: prNodeId,
          type: "pull_request",
          label: `#${pullRequest.number} ${pullRequest.title}`,
          timestamp: pullRequest.createdAt.toISOString(),
          data: {
            status: pullRequest.status,
            draft: pullRequest.isDraft,
            url: pullRequest.url
          }
        });
        addEdge({ from: branchNodeId, to: prNodeId, type: "branch_pr" });
      }
    }

    for (const event of intentEvents) {
      const eventNodeId = `intent:${event.id}`;
      addNode({
        id: eventNodeId,
        type: "intent_event",
        label: event.eventType,
        timestamp: event.occurredAt.toISOString(),
        data: input.includePayload
          ? {
              eventSeq: Number(event.eventSeq),
              source: event.source,
              redactionLevel: event.redactionLevel,
              payload: toRecord(event.payload)
            }
          : {
              eventSeq: Number(event.eventSeq),
              source: event.source,
              redactionLevel: event.redactionLevel
            }
      });
      addEdge({ from: taskNodeId, to: eventNodeId, type: "task_intent" });
    }

    for (const decision of taskDecisions) {
      const decisionNodeId = `decision:${decision.id}`;
      addNode({
        id: decisionNodeId,
        type: "task_decision",
        label: decision.summary,
        timestamp: decision.createdAt.toISOString(),
        data: {
          decisionType: decision.decisionType,
          decidedBy: decision.decidedBy ?? null
        }
      });
      addEdge({ from: taskNodeId, to: decisionNodeId, type: "task_decision" });

      if (decision.relatedEventId) {
        addEdge({
          from: `intent:${decision.relatedEventId}`,
          to: decisionNodeId,
          type: "intent_decision"
        });
      }

      if (decision.decisionType === "commit_metadata_linked") {
        const commit = parseCommitLink(decision.rationale);
        if (commit.commitSha) {
          const commitNodeId = `commit:${commit.commitSha}`;
          addNode({
            id: commitNodeId,
            type: "commit",
            label: commit.commitSha.slice(0, 12),
            timestamp: decision.createdAt.toISOString(),
            data: {
              sha: commit.commitSha,
              runId: commit.runId ?? null,
              intentId: commit.intentId ?? null
            }
          });
          addEdge({ from: decisionNodeId, to: commitNodeId, type: "decision_commit" });

          if (commit.runId) {
            addEdge({ from: `airun:${commit.runId}`, to: commitNodeId, type: "run_commit" });
          }
          if (commit.intentId) {
            addEdge({ from: `intent:${commit.intentId}`, to: commitNodeId, type: "intent_commit" });
          }
        }
      }
    }

    for (const run of aiRuns) {
      const runNodeId = `airun:${run.id}`;
      addNode({
        id: runNodeId,
        type: "ai_run",
        label: `${run.provider}:${run.model}`,
        timestamp: run.startedAt.toISOString(),
        data: {
          status: run.status,
          inputTokens: run.inputTokens ?? null,
          outputTokens: run.outputTokens ?? null,
          latencyMs: run.latencyMs ?? null
        }
      });
      addEdge({ from: taskNodeId, to: runNodeId, type: "task_ai_run" });
      if (run.branchId) {
        addEdge({ from: `branch:${run.branchId}`, to: runNodeId, type: "branch_ai_run" });
      }
    }

    for (const run of qualityRuns) {
      const runNodeId = `quality:${run.id}`;
      addNode({
        id: runNodeId,
        type: "quality_run",
        label: run.status,
        timestamp: run.createdAt.toISOString(),
        data: {
          triggerSource: run.triggerSource,
          startedAt: run.startedAt?.toISOString() ?? null,
          endedAt: run.endedAt?.toISOString() ?? null
        }
      });
      addEdge({ from: taskNodeId, to: runNodeId, type: "task_quality_run" });

      for (const check of run.checks) {
        const checkNodeId = `quality-check:${check.id}`;
        addNode({
          id: checkNodeId,
          type: "quality_check",
          label: check.checkKey,
          timestamp: check.createdAt.toISOString(),
          data: {
            status: check.status,
            durationMs: check.durationMs ?? null,
            logUrl: check.logUrl ?? null
          }
        });
        addEdge({ from: runNodeId, to: checkNodeId, type: "quality_run_check" });
      }

      for (const artifact of run.artifacts) {
        const artifactNodeId = `quality-artifact:${artifact.id}`;
        addNode({
          id: artifactNodeId,
          type: "quality_artifact",
          label: artifact.artifactType,
          timestamp: artifact.createdAt.toISOString(),
          data: {
            storageProvider: artifact.storageProvider,
            storageKey: artifact.storageKey,
            retentionClass: artifact.retentionClass,
            contentType: artifact.contentType ?? null,
            sizeBytes: artifact.sizeBytes ?? null
          }
        });

        addEdge({
          from: artifact.checkId ? `quality-check:${artifact.checkId}` : runNodeId,
          to: artifactNodeId,
          type: "quality_artifact_link"
        });
      }
    }

    for (const handoff of handoffs) {
      const handoffNodeId = `handoff:${handoff.id}`;
      addNode({
        id: handoffNodeId,
        type: "handoff",
        label: handoff.summary,
        timestamp: handoff.createdAt.toISOString(),
        data: {
          generatedBy: handoff.generatedBy ?? null
        }
      });
      addEdge({ from: taskNodeId, to: handoffNodeId, type: "task_handoff" });

      for (const ack of handoff.acks) {
        const ackNodeId = `handoff-ack:${ack.id}`;
        addNode({
          id: ackNodeId,
          type: "handoff_ack",
          label: ack.notes ?? `Acknowledged by ${ack.ackBy}`,
          timestamp: ack.ackAt.toISOString(),
          data: {
            ackBy: ack.ackBy
          }
        });
        addEdge({ from: handoffNodeId, to: ackNodeId, type: "handoff_ack" });
      }
    }

    for (const conflict of conflicts) {
      const conflictNodeId = `conflict:${conflict.id}`;
      addNode({
        id: conflictNodeId,
        type: "conflict",
        label: `${conflict.severity}:${Number(conflict.score)}`,
        timestamp: conflict.createdAt.toISOString(),
        data: {
          severity: conflict.severity,
          score: Number(conflict.score),
          resolutionStatus: conflict.resolutionStatus,
          filePaths: conflict.filePaths
        }
      });
      addEdge({ from: taskNodeId, to: conflictNodeId, type: "task_conflict" });
      if (conflict.otherTaskId) {
        addEdge({ from: conflictNodeId, to: `task:${conflict.otherTaskId}`, type: "conflict_other_task" });
      }
    }

    for (const usage of promptUsages) {
      const usageNodeId = `prompt-usage:${usage.id}`;
      addNode({
        id: usageNodeId,
        type: "prompt_usage",
        label: usage.templateId ? `template:${usage.templateId}` : "prompt-usage",
        timestamp: usage.createdAt.toISOString(),
        data: {
          templateId: usage.templateId ?? null,
          templateVersionId: usage.templateVersionId ?? null,
          aiRunId: usage.aiRunId ?? null,
          successRating: usage.successRating ?? null
        }
      });
      addEdge({ from: taskNodeId, to: usageNodeId, type: "task_prompt_usage" });

      if (usage.aiRunId) {
        addEdge({ from: `airun:${usage.aiRunId}`, to: usageNodeId, type: "run_prompt_usage" });
      }
    }

    for (const snapshot of replaySnapshots) {
      const snapshotNodeId = `replay:${snapshot.id}`;
      addNode({
        id: snapshotNodeId,
        type: "replay_snapshot",
        label: `v${snapshot.snapshotVersion}`,
        timestamp: snapshot.createdAt.toISOString(),
        data: {
          snapshotVersion: snapshot.snapshotVersion,
          artifactUrl: snapshot.artifactUrl ?? null
        }
      });
      addEdge({ from: taskNodeId, to: snapshotNodeId, type: "task_replay_snapshot" });
    }

    const nodes = [...nodeMap.values()];

    return {
      taskId: task.id,
      generatedAt: new Date().toISOString(),
      counts: {
        nodes: nodes.length,
        edges: edges.length,
        intentEvents: intentEvents.length,
        decisions: taskDecisions.length,
        aiRuns: aiRuns.length,
        qualityRuns: qualityRuns.length,
        handoffs: handoffs.length,
        conflicts: conflicts.length
      },
      nodes,
      edges
    };
  }
}
