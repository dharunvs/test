import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import type { AuthContext } from "../src/modules/auth/auth.types.js";
import { ActivityController } from "../src/modules/activity/activity.controller.js";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const TASK_ID = "33333333-3333-3333-3333-333333333333";
const BRANCH_ID = "44444444-4444-4444-4444-444444444444";
const REPOSITORY_ID = "55555555-5555-5555-5555-555555555555";

const USER: AuthContext = {
  userId: "66666666-6666-6666-6666-666666666666",
  clerkUserId: "clerk_user_1",
  email: "member@branchline.dev",
  role: "member"
};

describe("ActivityController", () => {
  it("updates presence, records events, and emits activity envelopes", async () => {
    const prisma = {
      activityPresence: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({
          id: "77777777-7777-7777-7777-777777777777",
          projectId: PROJECT_ID,
          userId: USER.userId
        })
      },
      activityEvent: {
        create: vi.fn().mockResolvedValue({})
      }
    } as unknown as PrismaService;

    const realtime = {
      emitToProject: vi.fn()
    };

    const controller = new ActivityController(realtime as never, prisma);
    const result = await controller.updatePresence(
      {
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        taskId: TASK_ID,
        branchId: BRANCH_ID,
        repositoryId: REPOSITORY_ID,
        state: "editing",
        activeFilePath: "apps/api-server/src/modules/activity/activity.controller.ts",
        activeSymbol: "updatePresence"
      },
      USER
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        presence: expect.objectContaining({
          id: "77777777-7777-7777-7777-777777777777"
        })
      })
    );
    expect(prisma.activityPresence.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.activityPresence.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.activityEvent.create).toHaveBeenCalledTimes(2);
    expect(realtime.emitToProject).toHaveBeenCalledTimes(2);
    expect(realtime.emitToProject).toHaveBeenNthCalledWith(
      1,
      PROJECT_ID,
      "activity.user_state_changed",
      expect.objectContaining({
        orgId: ORG_ID,
        projectId: PROJECT_ID
      })
    );
    expect(realtime.emitToProject).toHaveBeenNthCalledWith(
      2,
      PROJECT_ID,
      "activity.file_focus_changed",
      expect.objectContaining({
        orgId: ORG_ID,
        projectId: PROJECT_ID
      })
    );
  });
});
