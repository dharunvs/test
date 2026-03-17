import { createHash } from "node:crypto";

import { Controller, Get, NotFoundException, Param } from "@nestjs/common";

import { PrismaService } from "../../common/prisma.service.js";
import { Roles } from "../auth/roles.decorator.js";

@Controller("replay")
export class ReplayController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles("owner", "admin", "member", "viewer")
  @Get(":taskId")
  async getReplay(@Param("taskId") taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: {
        id: taskId
      },
      include: {
        intentEvents: {
          orderBy: {
            eventSeq: "asc"
          }
        },
        qualityGateRuns: {
          orderBy: {
            createdAt: "asc"
          }
        },
        handoffPackets: {
          orderBy: {
            createdAt: "asc"
          }
        },
        branches: {
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    const steps = [
      ...task.intentEvents.map((event) => event.eventType),
      ...task.qualityGateRuns.map((run) => `quality.${run.status}`),
      ...task.handoffPackets.map(() => "handoff.created")
    ];

    const latestSnapshot = await this.prisma.replaySnapshot.findFirst({
      where: {
        taskId
      },
      orderBy: {
        snapshotVersion: "desc"
      }
    });

    const nextVersion = (latestSnapshot?.snapshotVersion ?? 0) + 1;

    const snapshot = await this.prisma.replaySnapshot.create({
      data: {
        orgId: task.orgId,
        projectId: task.projectId,
        taskId,
        snapshotVersion: nextVersion,
        snapshot: {
          taskId,
          title: task.title,
          steps,
          branchCount: task.branches.length,
          generatedAt: new Date().toISOString()
        }
      }
    });

    return {
      taskId,
      snapshotVersion: snapshot.snapshotVersion,
      generatedAt: snapshot.createdAt,
      steps
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get(":taskId/export")
  async exportReplay(@Param("taskId") taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: {
        id: taskId
      },
      include: {
        intentEvents: {
          orderBy: {
            eventSeq: "asc"
          }
        },
        branches: {
          orderBy: {
            createdAt: "asc"
          },
          include: {
            pullRequests: {
              orderBy: {
                createdAt: "asc"
              }
            }
          }
        },
        handoffPackets: {
          include: {
            acks: true
          }
        },
        qualityGateRuns: {
          include: {
            checks: true
          }
        }
      }
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    const report = {
      taskId: task.id,
      title: task.title,
      status: task.status,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      intentEvents: task.intentEvents,
      branches: task.branches,
      qualityRuns: task.qualityGateRuns,
      handoffs: task.handoffPackets
    };

    const digest = createHash("sha256").update(JSON.stringify(report)).digest("hex");

    return {
      generatedAt: new Date().toISOString(),
      digest,
      report
    };
  }
}
