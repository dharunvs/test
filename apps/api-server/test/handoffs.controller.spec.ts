import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import type { AuthContext } from "../src/modules/auth/auth.types.js";
import { HandoffsController } from "../src/modules/handoffs/handoffs.controller.js";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const TASK_ID = "33333333-3333-3333-3333-333333333333";
const BRANCH_ID = "44444444-4444-4444-4444-444444444444";
const HANDOFF_ID = "55555555-5555-5555-5555-555555555555";

const USER: AuthContext = {
  userId: "66666666-6666-6666-6666-666666666666",
  clerkUserId: "clerk_user_1",
  email: "member@branchline.dev",
  role: "member"
};

describe("HandoffsController", () => {
  it("creates handoff packet, enqueues generation, and emits realtime event", async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: TASK_ID,
          orgId: ORG_ID,
          projectId: PROJECT_ID,
          repositoryId: "77777777-7777-7777-7777-777777777777"
        })
      },
      handoffPacket: {
        create: vi.fn().mockResolvedValue({
          id: HANDOFF_ID,
          taskId: TASK_ID,
          projectId: PROJECT_ID,
          summary: "Current status"
        })
      }
    } as unknown as PrismaService;

    const realtime = {
      emitToProject: vi.fn()
    };
    const handoffQueue = {
      add: vi.fn().mockResolvedValue(undefined)
    };

    const controller = new HandoffsController(prisma, realtime as never, handoffQueue as never);
    const result = await controller.create(
      {
        taskId: TASK_ID,
        branchId: BRANCH_ID,
        summary: "Current status",
        constraints: "No DB changes",
        risks: "Race conditions",
        nextSteps: "Finalize tests"
      },
      USER
    );

    expect(result).toEqual({
      id: HANDOFF_ID,
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      summary: "Current status"
    });
    expect(handoffQueue.add).toHaveBeenCalledWith(
      "generate",
      expect.objectContaining({
        handoffId: HANDOFF_ID,
        taskId: TASK_ID,
        projectId: PROJECT_ID
      }),
      expect.any(Object)
    );
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      PROJECT_ID,
      "handoff.created",
      expect.objectContaining({
        orgId: ORG_ID,
        projectId: PROJECT_ID
      })
    );
  });

  it("acks handoff with upsert semantics", async () => {
    const prisma = {
      handoffAck: {
        upsert: vi.fn().mockResolvedValue({
          id: "88888888-8888-8888-8888-888888888888",
          handoffPacketId: HANDOFF_ID,
          ackBy: USER.userId,
          notes: "Taking over now"
        })
      }
    } as unknown as PrismaService;

    const controller = new HandoffsController(
      prisma,
      {
        emitToProject: vi.fn()
      } as never,
      {
        add: vi.fn()
      } as never
    );

    const result = await controller.ack(HANDOFF_ID, { notes: "Taking over now" }, USER);
    expect(result).toEqual({
      id: "88888888-8888-8888-8888-888888888888",
      handoffPacketId: HANDOFF_ID,
      ackBy: USER.userId,
      notes: "Taking over now"
    });
    expect(prisma.handoffAck.upsert).toHaveBeenCalledTimes(1);
  });
});
