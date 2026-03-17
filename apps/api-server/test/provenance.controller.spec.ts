import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { ProvenanceController } from "../src/modules/provenance/provenance.controller.js";

const TASK_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const ORG_ID = "33333333-3333-3333-3333-333333333333";

describe("ProvenanceController", () => {
  it("builds a graph with task and linked entities", async () => {
    const now = new Date("2026-03-09T00:00:00.000Z");

    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: TASK_ID,
          title: "Task",
          status: "in_progress",
          repositoryId: "44444444-4444-4444-4444-444444444444",
          projectId: PROJECT_ID,
          orgId: ORG_ID,
          createdAt: now
        })
      },
      branch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "55555555-5555-5555-5555-555555555555",
            name: "ai/task/demo",
            status: "active",
            baseBranch: "main",
            headSha: "abc",
            createdAt: now,
            pullRequests: []
          }
        ])
      },
      intentEvent: {
        findMany: vi.fn().mockResolvedValue([])
      },
      taskDecision: {
        findMany: vi.fn().mockResolvedValue([])
      },
      aiRun: {
        findMany: vi.fn().mockResolvedValue([])
      },
      qualityGateRun: {
        findMany: vi.fn().mockResolvedValue([])
      },
      handoffPacket: {
        findMany: vi.fn().mockResolvedValue([])
      },
      conflictEvent: {
        findMany: vi.fn().mockResolvedValue([])
      },
      promptUsage: {
        findMany: vi.fn().mockResolvedValue([])
      },
      replaySnapshot: {
        findMany: vi.fn().mockResolvedValue([])
      }
    } as unknown as PrismaService;

    const controller = new ProvenanceController(prisma);
    const result = await controller.graph({
      taskId: TASK_ID
    });

    expect(result.taskId).toBe(TASK_ID);
    expect(result.counts.nodes).toBeGreaterThanOrEqual(2);
    expect(result.nodes.some((node) => node.type === "task")).toBe(true);
    expect(result.nodes.some((node) => node.type === "branch")).toBe(true);
  });
});
