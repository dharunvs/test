import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import { NotificationsController } from "../src/modules/notifications/notifications.controller.js";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const NOTIFICATION_ID = "22222222-2222-2222-2222-222222222222";

describe("NotificationsController", () => {
  it("returns notification_not_found when callback target is missing", async () => {
    const prisma = {
      notification: {
        findUnique: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaService;

    const notificationQueue = {
      add: vi.fn()
    };

    const analyticsQueue = {
      add: vi.fn()
    };

    const controller = new NotificationsController(prisma, notificationQueue as never, analyticsQueue as never);
    const result = await controller.callback(NOTIFICATION_ID, {
      orgId: ORG_ID,
      status: "failed",
      error: "provider_failure"
    });

    expect(result).toEqual({
      updated: false,
      reason: "notification_not_found"
    });
    expect(analyticsQueue.add).not.toHaveBeenCalled();
  });

  it("updates delivery status and emits analytics event", async () => {
    const prisma = {
      notification: {
        findUnique: vi.fn().mockResolvedValue({
          id: NOTIFICATION_ID,
          orgId: ORG_ID,
          projectId: "33333333-3333-3333-3333-333333333333",
          sentAt: null,
          deliveredAt: null,
          failedAt: null
        }),
        update: vi.fn().mockResolvedValue({
          id: NOTIFICATION_ID,
          orgId: ORG_ID,
          projectId: "33333333-3333-3333-3333-333333333333",
          status: "delivered",
          retryCount: 0
        })
      }
    } as unknown as PrismaService;

    const notificationQueue = {
      add: vi.fn()
    };

    const analyticsQueue = {
      add: vi.fn()
    };

    const controller = new NotificationsController(prisma, notificationQueue as never, analyticsQueue as never);
    const result = await controller.callback(NOTIFICATION_ID, {
      orgId: ORG_ID,
      status: "delivered",
      providerMessageId: "provider-msg-1",
      statusCode: 202,
      metadata: {
        provider: "slack"
      }
    });

    expect(result).toEqual({
      updated: true,
      id: NOTIFICATION_ID,
      status: "delivered",
      retryCount: 0
    });
    expect(prisma.notification.update).toHaveBeenCalledTimes(1);
    expect(analyticsQueue.add).toHaveBeenCalledWith(
      "rollup",
      expect.objectContaining({
        orgId: ORG_ID,
        source: "notification_delivered"
      }),
      expect.any(Object)
    );
  });

  it("increments retry count on retrying callback status", async () => {
    const prisma = {
      notification: {
        findUnique: vi.fn().mockResolvedValue({
          id: NOTIFICATION_ID,
          orgId: ORG_ID,
          projectId: null,
          sentAt: new Date(),
          deliveredAt: null,
          failedAt: null
        }),
        update: vi.fn().mockResolvedValue({
          id: NOTIFICATION_ID,
          orgId: ORG_ID,
          projectId: null,
          status: "retrying",
          retryCount: 2
        })
      }
    } as unknown as PrismaService;

    const notificationQueue = {
      add: vi.fn()
    };

    const analyticsQueue = {
      add: vi.fn()
    };

    const controller = new NotificationsController(prisma, notificationQueue as never, analyticsQueue as never);
    const result = await controller.callback(NOTIFICATION_ID, {
      orgId: ORG_ID,
      status: "retrying",
      error: "transient_timeout"
    });

    expect(result).toEqual({
      updated: true,
      id: NOTIFICATION_ID,
      status: "retrying",
      retryCount: 2
    });
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: NOTIFICATION_ID
        },
        data: expect.objectContaining({
          status: "retrying",
          retryCount: {
            increment: 1
          }
        })
      })
    );
  });
});
