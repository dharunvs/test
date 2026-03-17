import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { QualityGatesController } from "../src/modules/quality-gates/quality-gates.controller.js";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const TASK_ID = "33333333-3333-3333-3333-333333333333";
const BRANCH_ID = "44444444-4444-4444-4444-444444444444";

describe("QualityGatesController", () => {
  it("queues quality run, PR slicing, and analytics rollup", async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: TASK_ID,
          orgId: ORG_ID,
          projectId: PROJECT_ID,
          branches: [{ id: BRANCH_ID }]
        })
      },
      qualityGateRun: {
        create: vi.fn().mockResolvedValue({
          id: "55555555-5555-5555-5555-555555555555",
          orgId: ORG_ID,
          projectId: PROJECT_ID,
          taskId: TASK_ID,
          branchId: BRANCH_ID,
          status: "queued"
        })
      }
    } as unknown as PrismaService;

    const qualityQueue = {
      add: vi.fn().mockResolvedValue(undefined)
    };
    const prSliceQueue = {
      add: vi.fn().mockResolvedValue(undefined)
    };
    const analyticsQueue = {
      add: vi.fn().mockResolvedValue(undefined)
    };

    const controller = new QualityGatesController(
      prisma,
      {
        emitToProject: vi.fn()
      } as never,
      qualityQueue as never,
      prSliceQueue as never,
      analyticsQueue as never
    );

    const result = await controller.run({
      taskId: TASK_ID,
      triggerSource: "manual",
      workspacePath: "/tmp/workspace",
      checkCommands: {
        build: "pnpm build",
        unit_tests: "pnpm test",
        lint: "pnpm lint",
        dependency_audit: "pnpm audit --audit-level high"
      }
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: "55555555-5555-5555-5555-555555555555",
        status: "queued"
      })
    );
    expect(qualityQueue.add).toHaveBeenCalledWith(
      "run",
      expect.objectContaining({
        runId: "55555555-5555-5555-5555-555555555555",
        taskId: TASK_ID
      }),
      expect.any(Object)
    );
    expect(prSliceQueue.add).toHaveBeenCalledWith(
      "slice",
      expect.objectContaining({
        runId: "55555555-5555-5555-5555-555555555555",
        taskId: TASK_ID
      }),
      expect.any(Object)
    );
    expect(analyticsQueue.add).toHaveBeenCalledWith(
      "rollup",
      expect.objectContaining({
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        taskId: TASK_ID
      }),
      expect.any(Object)
    );
  });

  it("throws not found when task is missing", async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaService;

    const controller = new QualityGatesController(
      prisma,
      {
        emitToProject: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never
    );

    await expect(
      controller.run({
        taskId: TASK_ID
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns quality run details with checks summary and artifact count", async () => {
    const realtime = {
      emitToProject: vi.fn()
    };
    const prisma = {
      qualityGateRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: "run-1",
          orgId: ORG_ID,
          projectId: PROJECT_ID,
          taskId: TASK_ID,
          branchId: BRANCH_ID,
          triggerSource: "manual",
          status: "passed",
          createdAt: new Date("2026-03-11T00:00:00.000Z"),
          checks: [
            { status: "queued" },
            { status: "running" },
            { status: "passed" },
            { status: "failed" },
            { status: "canceled" }
          ],
          artifacts: [{ id: "artifact-1" }, { id: "artifact-2" }]
        })
      }
    } as unknown as PrismaService;

    const controller = new QualityGatesController(
      prisma,
      realtime as never,
      {
        add: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never
    );

    const result = await controller.getRun("run-1");
    expect(result).toEqual(
      expect.objectContaining({
        id: "run-1",
        artifactCount: 2,
        checksSummary: {
          queued: 1,
          running: 1,
          passed: 1,
          failed: 1,
          canceled: 1
        }
      })
    );
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      "quality_gate.completed",
      expect.objectContaining({
        projectId: PROJECT_ID
      })
    );
  });

  it("returns artifact records with optional metadata projection", async () => {
    const prisma = {
      qualityGateRun: {
        findUnique: vi.fn().mockResolvedValue({ id: "run-1" })
      },
      qualityArtifact: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "artifact-1",
            runId: "run-1",
            checkId: "check-1",
            artifactType: "build-log",
            storageProvider: "s3",
            storageKey: "logs/build.log",
            contentType: "text/plain",
            sizeBytes: 1024,
            retentionClass: "default",
            metadata: {
              sha: "abc123"
            },
            createdAt: new Date("2026-03-11T00:00:00.000Z"),
            check: {
              id: "check-1",
              checkKey: "build",
              status: "passed"
            }
          }
        ])
      }
    } as unknown as PrismaService;

    const controller = new QualityGatesController(
      prisma,
      {
        emitToProject: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never
    );

    const withoutMetadata = await controller.listArtifacts("run-1", {
      includeMetadata: "false"
    });
    const withMetadata = await controller.listArtifacts("run-1", {
      includeMetadata: "true"
    });

    expect(withoutMetadata).toEqual([
      expect.objectContaining({
        id: "artifact-1",
        checkKey: "build",
        checkStatus: "passed",
        metadata: undefined
      })
    ]);
    expect(withMetadata).toEqual([
      expect.objectContaining({
        id: "artifact-1",
        checkKey: "build",
        checkStatus: "passed",
        metadata: {
          sha: "abc123"
        }
      })
    ]);
  });
});
