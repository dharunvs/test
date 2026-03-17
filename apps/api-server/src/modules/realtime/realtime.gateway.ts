import { Injectable } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WsException,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

import type { EventEnvelope, SocketEventName } from "@branchline/shared-events";

import { readEnv } from "../../common/env.js";
import { incrementRealtimeEvent } from "../../common/metrics.js";
import { PrismaService } from "../../common/prisma.service.js";
import { AuthService } from "../auth/auth.service.js";
import type { AuthContext } from "../auth/auth.types.js";

@WebSocketGateway({ cors: { origin: true } })
@Injectable()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly env = readEnv();

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService
  ) {}

  afterInit() {
    // startup hook for metrics/tracing when observability is enabled
  }

  async handleConnection(client: Socket) {
    const token = this.extractBearerToken(client);
    if (token) {
      try {
        const auth = await this.authService.authenticateToken(token);
        client.data.auth = auth;
        client.emit("connected", {
          socketId: client.id,
          userId: auth.userId
        });
        return;
      } catch {
        if (!this.env.realtimeAllowAnonymous) {
          client.emit("error", { reason: "invalid_token" });
          client.disconnect();
          return;
        }
      }
    }

    if (!this.env.realtimeAllowAnonymous) {
      client.emit("error", { reason: "authentication_required" });
      client.disconnect();
      return;
    }

    client.emit("connected", { socketId: client.id, anonymous: true });
  }

  @SubscribeMessage("join_project")
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectId?: string }
  ) {
    if (!body?.projectId) {
      return;
    }
    await this.assertProjectScope(client, body.projectId);

    client.join(`project:${body.projectId}`);
  }

  @SubscribeMessage("join_task")
  async handleJoinTask(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { taskId?: string }
  ) {
    if (!body?.taskId) {
      return;
    }

    const task = await this.prisma.task.findUnique({
      where: {
        id: body.taskId
      },
      select: {
        projectId: true
      }
    });

    if (!task) {
      throw new WsException("task_not_found");
    }

    await this.assertProjectScope(client, task.projectId);
    client.join(`task:${body.taskId}`);
  }

  @SubscribeMessage("leave_project")
  handleLeaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectId?: string }
  ) {
    if (body?.projectId) {
      client.leave(`project:${body.projectId}`);
    }
  }

  @SubscribeMessage("leave_task")
  handleLeaveTask(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { taskId?: string }
  ) {
    if (body?.taskId) {
      client.leave(`task:${body.taskId}`);
    }
  }

  emit(event: SocketEventName, payload: EventEnvelope) {
    incrementRealtimeEvent(event);
    this.server.emit(event, payload);
  }

  emitToProject(projectId: string, event: SocketEventName, payload: EventEnvelope) {
    incrementRealtimeEvent(event);
    this.server.to(`project:${projectId}`).emit(event, payload);
    if (payload.context.taskId) {
      this.server.to(`task:${payload.context.taskId}`).emit(event, payload);
    }
  }

  emitToTask(taskId: string, event: SocketEventName, payload: EventEnvelope) {
    incrementRealtimeEvent(event);
    this.server.to(`task:${taskId}`).emit(event, payload);
  }

  private async assertProjectScope(client: Socket, projectId: string) {
    const auth = client.data.auth as AuthContext | undefined;
    if (!auth && !this.env.realtimeAllowAnonymous) {
      throw new WsException("authentication_required");
    }

    if (!auth) {
      return;
    }

    const project = await this.prisma.project.findUnique({
      where: {
        id: projectId
      },
      select: {
        orgId: true
      }
    });

    if (!project) {
      throw new WsException("project_not_found");
    }

    const [orgMembership, projectMembership] = await Promise.all([
      this.prisma.organizationMember.findFirst({
        where: {
          orgId: project.orgId,
          userId: auth.userId,
          status: "active"
        }
      }),
      this.prisma.projectMember.findFirst({
        where: {
          projectId,
          userId: auth.userId,
          status: "active"
        }
      })
    ]);

    if (!orgMembership) {
      throw new WsException("forbidden_project_scope");
    }

    const isOrgAdmin = orgMembership.role === "owner" || orgMembership.role === "admin";
    if (!isOrgAdmin && !projectMembership) {
      throw new WsException("forbidden_project_scope");
    }
  }

  private extractBearerToken(client: Socket): string | undefined {
    const handshakeToken = client.handshake.auth?.token;
    if (typeof handshakeToken === "string" && handshakeToken.trim().length > 0) {
      return handshakeToken.trim();
    }

    const authHeader = client.handshake.headers.authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token.length > 0) {
        return token;
      }
    }

    return undefined;
  }
}
