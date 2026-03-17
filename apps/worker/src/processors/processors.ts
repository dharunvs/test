import type { Job } from "bullmq";
import { PrismaClient, type Prisma } from "@prisma/client";
import { execaCommand } from "execa";

import { readWorkerEnv } from "../env.js";

readWorkerEnv();

const prisma = new PrismaClient();

function extractTouchedFiles(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const direct = record.changedFiles;
  if (Array.isArray(direct)) {
    return direct.filter((item): item is string => typeof item === "string").slice(0, 50);
  }

  const single = record.changedFile;
  if (typeof single === "string") {
    return [single];
  }

  return [];
}

export async function processIntentNormalize(job: Job) {
  const payload = (job.data ?? {}) as {
    eventId?: string;
    taskId?: string;
    projectId?: string;
    orgId?: string;
  };

  if (!payload.taskId) {
    return {
      jobId: job.id,
      normalized: false,
      reason: "taskId_missing"
    };
  }

  const intentEvent = payload.eventId
    ? await prisma.intentEvent.findUnique({
        where: {
          id: payload.eventId
        }
      })
    : null;

  await prisma.taskDecision
    .create({
      data: {
        orgId: payload.orgId ?? intentEvent?.orgId ?? "00000000-0000-0000-0000-000000000001",
        projectId: payload.projectId ?? intentEvent?.projectId ?? "00000000-0000-0000-0000-000000000001",
        taskId: payload.taskId,
        decisionType: "intent_normalized",
        summary: `Intent event ${payload.eventId ?? "unknown"} normalized`,
        rationale: JSON.stringify({
          eventId: payload.eventId,
          eventType: intentEvent?.eventType
        })
      }
    })
    .catch(() => {
      // Task may have been deleted or event reprocessed.
    });

  return {
    jobId: job.id,
    normalized: true,
    receivedAt: new Date().toISOString()
  };
}

export async function processConflictScore(job: Job) {
  const payload = (job.data ?? {}) as {
    conflictId?: string;
  };

  if (!payload.conflictId) {
    return {
      jobId: job.id,
      scoreComputed: false,
      reason: "conflictId_missing"
    };
  }

  const conflict = await prisma.conflictEvent.findUnique({
    where: {
      id: payload.conflictId
    }
  });

  if (!conflict) {
    return {
      jobId: job.id,
      scoreComputed: false,
      reason: "conflict_not_found"
    };
  }

  if (conflict.taskId && Number(conflict.score) >= 60) {
    await prisma.taskDecision
      .create({
        data: {
          orgId: conflict.orgId,
          projectId: conflict.projectId,
          taskId: conflict.taskId,
          decisionType: "conflict_high_risk",
          summary: `Conflict ${conflict.id} scored ${Number(conflict.score)}`,
          rationale: JSON.stringify({
            severity: conflict.severity,
            filePaths: conflict.filePaths,
            symbolNames: conflict.symbolNames
          })
        }
      })
      .catch(() => {
        // Best-effort analytics path.
      });
  }

  return {
    jobId: job.id,
    scoreComputed: true,
    severity: conflict.severity,
    receivedAt: new Date().toISOString()
  };
}

export async function processGuardrailEvaluate(job: Job) {
  const payload = (job.data ?? {}) as {
    evaluationId?: string;
    stage?: "pre_apply" | "pre_pr" | "promote";
    blocking?: boolean;
  };

  if (!payload.evaluationId) {
    return {
      jobId: job.id,
      evaluated: false,
      reason: "evaluationId_missing"
    };
  }

  const evaluation = await prisma.guardrailEvaluation.findUnique({
    where: {
      id: payload.evaluationId
    }
  });

  if (!evaluation) {
    return {
      jobId: job.id,
      evaluated: false,
      reason: "evaluation_not_found"
    };
  }

  const evaluationPayload =
    evaluation.violations && typeof evaluation.violations === "object" && !Array.isArray(evaluation.violations)
      ? (evaluation.violations as Record<string, unknown>)
      : undefined;
  const stage = payload.stage ?? (typeof evaluationPayload?.stage === "string" ? evaluationPayload.stage : undefined);
  const blocking =
    typeof payload.blocking === "boolean"
      ? payload.blocking
      : typeof evaluationPayload?.blocking === "boolean"
        ? evaluationPayload.blocking
        : evaluation.status === "fail";

  if (evaluation.status !== "pass") {
    await prisma.taskDecision
      .create({
        data: {
          orgId: evaluation.orgId,
          projectId: evaluation.projectId,
          taskId: evaluation.taskId,
          decisionType: "guardrail_violation",
          summary: `Guardrail evaluation ${evaluation.id} (${stage ?? "unspecified"}) ended with ${evaluation.status}`,
          rationale: JSON.stringify({
            stage: stage ?? null,
            blocking,
            status: evaluation.status,
            violations: evaluation.violations
          })
        }
      })
      .catch(() => {
        // Best effort path.
      });
  }

  return {
    jobId: job.id,
    evaluated: true,
    status: evaluation.status,
    receivedAt: new Date().toISOString()
  };
}

export async function processQualityRun(job: Job) {
  const payload = (job.data ?? {}) as {
    runId?: string;
    workspacePath?: string;
    checkCommands?: Partial<Record<"build" | "unit_tests" | "lint" | "dependency_audit" | "integration_tests", string>>;
  };
  if (!payload.runId) {
    return {
      jobId: job.id,
      status: "skipped",
      reason: "runId_missing"
    };
  }

  const run = await prisma.qualityGateRun.findUnique({
    where: {
      id: payload.runId
    },
    include: {
      task: true
    }
  });

  if (!run) {
    return {
      jobId: job.id,
      status: "skipped",
      reason: "run_not_found"
    };
  }

  await prisma.qualityGateRun.update({
    where: {
      id: run.id
    },
    data: {
      status: "running",
      startedAt: new Date()
    }
  });

  await prisma.qualityArtifact.deleteMany({
    where: {
      runId: run.id
    }
  });

  const baseChecks = ["build", "unit_tests", "lint", "dependency_audit"] as const;
  const checks = payload.checkCommands?.integration_tests
    ? [...baseChecks, "integration_tests" as const]
    : [...baseChecks];

  let passed = 0;
  let failed = 0;
  let canceled = 0;

  for (const checkKey of checks) {
    let checkStatus: "passed" | "failed" | "canceled" = "failed";
    let durationMs = 250;
    let details: Record<string, unknown> = {
      summary: `${checkKey} queued`
    };
    const startedAt = Date.now();
    const command = payload.checkCommands?.[checkKey];

    if (!payload.workspacePath) {
      failed += 1;
      details = {
        summary: `${checkKey} failed (workspacePath is required for command execution)`,
        executionMode: "commands",
        command: command ?? null
      };
    } else if (!command) {
      checkStatus = "canceled";
      canceled += 1;
      details = {
        summary: `${checkKey} skipped (command not configured)`,
        executionMode: "commands"
      };
    } else {
      try {
        const result = await execaCommand(command, {
          cwd: payload.workspacePath,
          shell: true,
          reject: false
        });
        durationMs = Math.max(1, Date.now() - startedAt);
        checkStatus = result.exitCode === 0 ? "passed" : "failed";
        if (checkStatus === "passed") {
          passed += 1;
        } else {
          failed += 1;
        }
        details = {
          summary: `${checkKey} ${checkStatus}`,
          executionMode: "commands",
          command,
          exitCode: result.exitCode,
          stdout: result.stdout.slice(0, 4000),
          stderr: result.stderr.slice(0, 4000)
        };
      } catch (error) {
        durationMs = Math.max(1, Date.now() - startedAt);
        checkStatus = "failed";
        failed += 1;
        details = {
          summary: `${checkKey} failed`,
          executionMode: "commands",
          command,
          error: error instanceof Error ? error.message : "command_execution_failed"
        };
      }
    }

    const persistedCheck = await prisma.qualityGateCheck.upsert({
      where: {
        runId_checkKey: {
          runId: run.id,
          checkKey
        }
      },
      update: {
        status: checkStatus,
        durationMs,
        details: details as Prisma.InputJsonValue
      },
      create: {
        runId: run.id,
        checkKey,
        status: checkStatus,
        durationMs,
        details: details as Prisma.InputJsonValue
      }
    });

    const detailRecord = details as Record<string, unknown>;
    const stdout = typeof detailRecord.stdout === "string" ? detailRecord.stdout : "";
    const stderr = typeof detailRecord.stderr === "string" ? detailRecord.stderr : "";
    const artifact = await prisma.qualityArtifact.create({
      data: {
        runId: run.id,
        checkId: persistedCheck.id,
        artifactType: "check-log",
        storageProvider: "inline",
        storageKey: `quality-runs/${run.id}/${checkKey}.log.json`,
        contentType: "application/json",
        sizeBytes: Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8"),
        retentionClass: "hot",
        metadata: {
          summary: detailRecord.summary ?? `${checkKey} ${checkStatus}`,
          executionMode: detailRecord.executionMode ?? "commands",
          command: detailRecord.command ?? null,
          exitCode: detailRecord.exitCode ?? null,
          stdoutPreview: stdout.slice(0, 2000),
          stderrPreview: stderr.slice(0, 2000)
        }
      }
    });

    await prisma.qualityGateCheck.update({
      where: {
        id: persistedCheck.id
      },
      data: {
        logUrl: `/v1/quality-gates/${run.id}/artifacts#${artifact.id}`
      }
    });
  }

  const runStatus = failed > 0 ? "failed" : passed > 0 ? "passed" : "canceled";

  await prisma.qualityGateRun.update({
    where: {
      id: run.id
    },
    data: {
      status: runStatus,
      endedAt: new Date(),
      summary: {
        executionMode: "commands",
        workspacePath: payload.workspacePath ?? null,
        checks: checks.length,
        passed,
        failed,
        canceled
      }
    }
  });

  await prisma.task.update({
    where: {
      id: run.taskId
    },
    data: {
      status: runStatus === "passed" ? "review" : "blocked"
    }
  });

  await prisma.activityEvent.create({
    data: {
      orgId: run.orgId,
      projectId: run.projectId,
      taskId: run.taskId,
      userId: run.task.assignedTo,
      eventType: "quality_gate.completed",
      filePath: null,
      symbol: null,
      payload: {
        runId: run.id,
        status: runStatus,
        checks: checks.length,
        passed,
        failed
      },
      occurredAt: new Date()
    }
  });

  return {
    jobId: job.id,
    status: runStatus,
    receivedAt: new Date().toISOString()
  };
}

export async function processPrSlice(job: Job) {
  const payload = (job.data ?? {}) as {
    runId?: string;
    pullRequestId?: string;
    taskId?: string;
  };

  let pullRequestId = payload.pullRequestId;
  let taskId = payload.taskId;
  let orgId: string | undefined;
  let projectId: string | undefined;

  if (payload.runId) {
    const run = await prisma.qualityGateRun.findUnique({
      where: {
        id: payload.runId
      }
    });

    if (run?.branchId) {
      const pullRequest = await prisma.pullRequest.findFirst({
        where: {
          branchId: run.branchId
        }
      });
      pullRequestId = pullRequest?.id;
    }

    taskId = taskId ?? run?.taskId;
    orgId = run?.orgId;
    projectId = run?.projectId;
  }

  if (!pullRequestId || !taskId) {
    return {
      jobId: job.id,
      slicesGenerated: false,
      reason: "missing_pull_request_or_task"
    };
  }

  const task = await prisma.task.findUnique({
    where: {
      id: taskId
    }
  });

  if (!task) {
    return {
      jobId: job.id,
      slicesGenerated: false,
      reason: "task_not_found"
    };
  }

  const intentEvents = await prisma.intentEvent.findMany({
    where: {
      taskId
    },
    orderBy: {
      occurredAt: "desc"
    },
    take: 20
  });

  const touchedFiles = Array.from(new Set(intentEvents.flatMap((event) => extractTouchedFiles(event.payload)))).slice(
    0,
    20
  );

  await prisma.prSlice.upsert({
    where: {
      pullRequestId_sliceOrder: {
        pullRequestId,
        sliceOrder: 1
      }
    },
    update: {
      title: "Core change set",
      description: "Primary implementation changes",
      filePaths: touchedFiles.length > 0 ? touchedFiles : ["(unknown files)"],
      riskLevel: touchedFiles.length > 10 ? "high" : "medium"
    },
    create: {
      orgId: orgId ?? task.orgId,
      projectId: projectId ?? task.projectId,
      taskId,
      pullRequestId,
      sliceOrder: 1,
      title: "Core change set",
      description: "Primary implementation changes",
      filePaths: touchedFiles.length > 0 ? touchedFiles : ["(unknown files)"],
      riskLevel: touchedFiles.length > 10 ? "high" : "medium"
    }
  });

  await prisma.prSlice.upsert({
    where: {
      pullRequestId_sliceOrder: {
        pullRequestId,
        sliceOrder: 2
      }
    },
    update: {
      title: "Risk review",
      description: "Files requiring extra reviewer focus",
      filePaths: touchedFiles.slice(0, 5),
      riskLevel: "high"
    },
    create: {
      orgId: orgId ?? task.orgId,
      projectId: projectId ?? task.projectId,
      taskId,
      pullRequestId,
      sliceOrder: 2,
      title: "Risk review",
      description: "Files requiring extra reviewer focus",
      filePaths: touchedFiles.slice(0, 5),
      riskLevel: "high"
    }
  });

  return {
    jobId: job.id,
    slicesGenerated: true,
    receivedAt: new Date().toISOString()
  };
}

export async function processHandoffGenerate(job: Job) {
  const payload = (job.data ?? {}) as {
    handoffId?: string;
    taskId?: string;
  };

  const handoff = payload.handoffId
    ? await prisma.handoffPacket.findUnique({
        where: {
          id: payload.handoffId
        }
      })
    : null;

  const taskId = handoff?.taskId ?? payload.taskId;

  if (!taskId || !handoff) {
    return {
      jobId: job.id,
      handoffCreated: false,
      reason: "handoff_or_task_missing"
    };
  }

  const recentEvents = await prisma.intentEvent.findMany({
    where: {
      taskId
    },
    orderBy: {
      occurredAt: "desc"
    },
    take: 15
  });

  const touchedFiles = Array.from(new Set(recentEvents.flatMap((event) => extractTouchedFiles(event.payload)))).slice(
    0,
    25
  );

  await prisma.handoffPacket.update({
    where: {
      id: handoff.id
    },
    data: {
      payload: {
        ...(handoff.payload as Record<string, unknown>),
        generatedAt: new Date().toISOString(),
        recentIntentEvents: recentEvents.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          source: event.source
        })),
        touchedFiles
      }
    }
  });

  return {
    jobId: job.id,
    handoffCreated: true,
    receivedAt: new Date().toISOString()
  };
}

export async function processNotificationsDispatch(job: Job) {
  const payload = (job.data ?? {}) as {
    notificationId?: string;
  };

  if (payload.notificationId) {
    await prisma.notification
      .update({
        where: {
          id: payload.notificationId
        },
        data: {
          status: "sent",
          sentAt: new Date()
        }
      })
      .catch(() => {
        // Best effort worker path.
      });
  }

  return {
    jobId: job.id,
    dispatched: true,
    receivedAt: new Date().toISOString()
  };
}

export async function processAnalyticsRollup(job: Job) {
  const payload = (job.data ?? {}) as {
    orgId?: string;
    projectId?: string;
    taskId?: string;
    source?: string;
  };

  if (payload.taskId && payload.orgId && payload.projectId && payload.source) {
    await prisma.taskDecision
      .create({
        data: {
          orgId: payload.orgId,
          projectId: payload.projectId,
          taskId: payload.taskId,
          decisionType: "analytics_rollup",
          summary: `Analytics rollup from ${payload.source}`,
          rationale: JSON.stringify(payload)
        }
      })
      .catch(() => {
        // Best effort path.
      });
  }

  return {
    jobId: job.id,
    rolledUp: true,
    receivedAt: new Date().toISOString()
  };
}
