import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { IntentController } from "../src/modules/intent/intent.controller.js";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const TASK_ID = "33333333-3333-3333-3333-333333333333";

describe("IntentController", () => {
  it("stores simplified intent event and returns accepted response", async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: TASK_ID,
          orgId: ORG_ID,
          projectId: PROJECT_ID
        })
      },
      redactionPolicy: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      $transaction: vi.fn().mockImplementation(async (callback) =>
        callback({
          intentEvent: {
            findFirst: vi.fn().mockResolvedValue({
              eventSeq: 2n
            }),
            create: vi.fn().mockResolvedValue({
              id: "event-1",
              eventSeq: 3n
            })
          }
        })
      )
    } as unknown as PrismaService;

    const queue = {
      add: vi.fn().mockResolvedValue(undefined)
    };

    const controller = new IntentController(prisma, queue as never);
    const result = await controller.create({
      taskId: TASK_ID,
      prompt: "Create JWT middleware",
      summary: "Added middleware with token validation",
      files: ["apps/api-server/src/auth.ts"],
      commitId: "abc1234"
    });

    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        taskId: TASK_ID,
        eventId: "event-1",
        eventSeq: 3
      })
    );
    expect(queue.add).toHaveBeenCalled();
  });

  it("throws when task is missing", async () => {
    const controller = new IntentController(
      {
        task: {
          findUnique: vi.fn().mockResolvedValue(null)
        }
      } as never,
      {
        add: vi.fn()
      } as never
    );

    await expect(
      controller.create({
        taskId: TASK_ID,
        prompt: "Prompt",
        summary: "Summary",
        files: [],
        commitId: "abc"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns latest intent events for a task", async () => {
    const controller = new IntentController(
      {
        intentEvent: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "event-2",
              eventSeq: 2n,
              occurredAt: new Date("2026-03-17T00:00:00.000Z"),
              payload: {
                prompt: "Prompt",
                summary: "Summary",
                files: ["a.ts"],
                commitId: "def4567"
              },
              redactionLevel: "none"
            }
          ])
        }
      } as never,
      {
        add: vi.fn()
      } as never
    );

    const result = await controller.list({
      taskId: TASK_ID,
      limit: "5"
    });

    expect(result.taskId).toBe(TASK_ID);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual(
      expect.objectContaining({
        eventId: "event-2",
        eventSeq: 2,
        prompt: "Prompt",
        summary: "Summary",
        commitId: "def4567"
      })
    );
  });
});

