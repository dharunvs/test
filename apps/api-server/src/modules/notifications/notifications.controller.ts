import { Body, Controller, Param, Post } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { z } from "zod";

import { toJson } from "../../common/json.js";
import { PrismaService } from "../../common/prisma.service.js";
import { reliableQueueOptions } from "../../common/queue-options.js";
import { Roles } from "../auth/roles.decorator.js";

const notifySchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  channel: z.enum(["in_app", "slack", "email"]),
  type: z.string(),
  payload: z.record(z.unknown())
});

const callbackSchema = z.object({
  orgId: z.string().uuid(),
  status: z.enum(["sent", "delivered", "failed", "retrying"]),
  providerMessageId: z.string().optional(),
  statusCode: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("queue.notifications.dispatch") private readonly notificationQueue: Queue,
    @InjectQueue("queue.analytics.rollup") private readonly analyticsQueue: Queue
  ) {}

  @Roles("owner", "admin", "member")
  @Post()
  async send(@Body() body: unknown) {
    const input = notifySchema.parse(body);

    const notification = await this.prisma.notification.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        userId: input.userId,
        channel: input.channel,
        type: input.type,
        payload: toJson(input.payload),
        status: "queued"
      }
    });

    await this.notificationQueue.add("dispatch", {
      notificationId: notification.id,
      channel: notification.channel
    }, reliableQueueOptions);

    await this.analyticsQueue.add("rollup", {
      orgId: notification.orgId,
      projectId: notification.projectId,
      source: "notification_queued"
    }, reliableQueueOptions);

    return notification;
  }

  @Roles("owner", "admin", "member")
  @Post(":id/callback")
  async callback(@Param("id") id: string, @Body() body: unknown) {
    const input = callbackSchema.parse(body);

    const existing = await this.prisma.notification.findUnique({
      where: {
        id
      }
    });

    if (!existing || existing.orgId !== input.orgId) {
      return {
        updated: false,
        reason: "notification_not_found"
      };
    }

    const now = new Date();
    const updated = await this.prisma.notification.update({
      where: {
        id
      },
      data: {
        status: input.status,
        providerMessageId: input.providerMessageId,
        lastStatusCode: input.statusCode,
        lastError: input.error,
        metadata: input.metadata ? toJson(input.metadata) : undefined,
        deliveredAt: input.status === "delivered" ? now : existing.deliveredAt,
        failedAt: input.status === "failed" ? now : existing.failedAt,
        sentAt:
          input.status === "sent" || input.status === "delivered"
            ? existing.sentAt ?? now
            : existing.sentAt,
        ...(input.status === "retrying"
          ? {
              retryCount: {
                increment: 1
              }
            }
          : {})
      }
    });

    await this.analyticsQueue.add(
      "rollup",
      {
        orgId: updated.orgId,
        projectId: updated.projectId,
        source: `notification_${input.status}`
      },
      reliableQueueOptions
    );

    return {
      updated: true,
      id: updated.id,
      status: updated.status,
      retryCount: updated.retryCount
    };
  }
}
