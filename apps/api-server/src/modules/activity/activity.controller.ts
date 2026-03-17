import { randomUUID } from "node:crypto";

import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { z } from "zod";

import { readEnv } from "../../common/env.js";
import { PrismaService } from "../../common/prisma.service.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";

const presenceQuerySchema = z.object({
  projectId: z.string().uuid()
});

const updatePresenceSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  repositoryId: z.string().uuid().optional(),
  state: z.string().default("editing"),
  activeFilePath: z.string().optional(),
  activeSymbol: z.string().optional()
});

@Controller("activity")
export class ActivityController {
  private readonly env = readEnv();

  constructor(
    private readonly realtime: RealtimeGateway,
    private readonly prisma: PrismaService
  ) {}

  @Roles("owner", "admin", "member", "viewer")
  @Get("presence")
  async presence(@Query() query: Record<string, unknown>) {
    const input = presenceQuerySchema.parse(query);
    await this.pruneStalePresence(input.projectId);

    return this.prisma.activityPresence.findMany({
      where: {
        projectId: input.projectId
      },
      orderBy: {
        lastSeenAt: "desc"
      }
    });
  }

  @Roles("owner", "admin", "member")
  @Post("presence")
  async updatePresence(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const payload = updatePresenceSchema.parse(body);
    await this.pruneStalePresence(payload.projectId);

    const presence = await this.prisma.activityPresence.upsert({
      where: {
        projectId_userId: {
          projectId: payload.projectId,
          userId: user.userId
        }
      },
      update: {
        orgId: payload.orgId,
        state: payload.state,
        activeFilePath: payload.activeFilePath,
        activeSymbol: payload.activeSymbol,
        lastSeenAt: new Date()
      },
      create: {
        orgId: payload.orgId,
        projectId: payload.projectId,
        userId: user.userId,
        state: payload.state,
        activeFilePath: payload.activeFilePath,
        activeSymbol: payload.activeSymbol,
        lastSeenAt: new Date()
      }
    });

    await this.prisma.activityEvent.create({
      data: {
        orgId: payload.orgId,
        projectId: payload.projectId,
        taskId: payload.taskId,
        userId: user.userId,
        eventType: "activity.user_state_changed",
        filePath: payload.activeFilePath,
        symbol: payload.activeSymbol,
        payload,
        occurredAt: new Date()
      }
    });

    const envelope = {
      eventId: randomUUID(),
      orgId: payload.orgId,
      projectId: payload.projectId,
      source: "web_console" as const,
      type: "activity.user_state_changed",
      timestamp: new Date().toISOString(),
      actor: {
        userId: user.userId,
        clientId: undefined
      },
      context: {
        taskId: payload.taskId,
        branchId: payload.branchId,
        repositoryId: payload.repositoryId
      },
      payload: {
        state: payload.state,
        activeFilePath: payload.activeFilePath,
        activeSymbol: payload.activeSymbol,
        presenceId: presence.id
      }
    };

    this.realtime.emitToProject(payload.projectId, "activity.user_state_changed", envelope);

    if (payload.activeFilePath) {
      const fileFocusEnvelope = {
        ...envelope,
        eventId: randomUUID(),
        type: "activity.file_focus_changed" as const,
        payload: {
          activeFilePath: payload.activeFilePath,
          activeSymbol: payload.activeSymbol,
          presenceId: presence.id
        }
      };

      await this.prisma.activityEvent.create({
        data: {
          orgId: payload.orgId,
          projectId: payload.projectId,
          taskId: payload.taskId,
          userId: user.userId,
          eventType: "activity.file_focus_changed",
          filePath: payload.activeFilePath,
          symbol: payload.activeSymbol,
          payload,
          occurredAt: new Date()
        }
      });

      this.realtime.emitToProject(payload.projectId, "activity.file_focus_changed", fileFocusEnvelope);
    }

    return {
      ok: true,
      presence
    };
  }

  private async pruneStalePresence(projectId: string) {
    const threshold = new Date(Date.now() - this.env.activityPresenceTtlSeconds * 1000);
    await this.prisma.activityPresence.deleteMany({
      where: {
        projectId,
        lastSeenAt: {
          lt: threshold
        }
      }
    });
  }
}
