import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { ObservabilityController } from "../src/modules/observability/observability.controller.js";

function queueStub() {
  return {
    name: "queue.stub",
    getJobCounts: vi.fn().mockResolvedValue({
      active: 0,
      completed: 0,
      delayed: 0,
      failed: 0,
      paused: 0,
      prioritized: 0,
      waiting: 0,
      "waiting-children": 0
    }),
    getJobs: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue(undefined)
  };
}

describe("ObservabilityController", () => {
  it("reports readiness when prisma responds", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
      activityEvent: {
        findMany: vi.fn().mockResolvedValue([])
      }
    } as unknown as PrismaService;

    const controller = new ObservabilityController(
      prisma,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never
    );

    const result = await controller.readiness();
    expect(result.status).toBe("ok");
    expect(result.generatedAt).toEqual(expect.any(String));
  });

  it("computes realtime latency percentiles from activity event ingestion lag", async () => {
    const base = new Date("2026-03-11T00:00:00.000Z");
    const prisma = {
      activityEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            occurredAt: new Date(base.getTime() + 0),
            createdAt: new Date(base.getTime() + 100)
          },
          {
            occurredAt: new Date(base.getTime() + 1_000),
            createdAt: new Date(base.getTime() + 1_200)
          },
          {
            occurredAt: new Date(base.getTime() + 2_000),
            createdAt: new Date(base.getTime() + 2_300)
          },
          {
            occurredAt: new Date(base.getTime() + 3_000),
            createdAt: new Date(base.getTime() + 3_400)
          },
          {
            occurredAt: new Date(base.getTime() + 4_000),
            createdAt: new Date(base.getTime() + 4_500)
          }
        ])
      }
    } as unknown as PrismaService;

    const controller = new ObservabilityController(
      prisma,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never
    );

    const result = await controller.realtimeLatency({
      projectId: "11111111-1111-1111-1111-111111111111",
      windowMinutes: "60"
    });

    expect(result).toEqual(
      expect.objectContaining({
        sampleCount: 5,
        p50Ms: 300,
        p95Ms: 500,
        maxMs: 500,
        targetP95Ms: 2000,
        withinTarget: true
      })
    );
  });

  it("returns zeroed latency metrics when no activity events exist", async () => {
    const prisma = {
      activityEvent: {
        findMany: vi.fn().mockResolvedValue([])
      }
    } as unknown as PrismaService;

    const controller = new ObservabilityController(
      prisma,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never,
      queueStub() as never
    );

    const result = await controller.realtimeLatency({
      projectId: "11111111-1111-1111-1111-111111111111",
      windowMinutes: 30
    });

    expect(result).toEqual(
      expect.objectContaining({
        sampleCount: 0,
        p50Ms: 0,
        p95Ms: 0,
        maxMs: 0,
        withinTarget: true
      })
    );
  });
});
