import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { z } from "zod";

import { appendAuditLog } from "../../common/audit.js";
import { readEnv } from "../../common/env.js";
import { decryptCredentials, encryptCredentials } from "../../common/integration-credentials.js";
import { toJson } from "../../common/json.js";
import { PrismaService } from "../../common/prisma.service.js";
import { reliableQueueOptions } from "../../common/queue-options.js";
import { Public } from "../auth/public.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";

const oauthProviderSchema = z.enum(["slack", "linear", "jira"]);
type OAuthProvider = z.infer<typeof oauthProviderSchema>;

const connectionSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  provider: z.enum(["slack", "linear", "jira", "gitlab", "github"]),
  externalWorkspaceId: z.string().optional(),
  credentials: z.record(z.unknown()).default({})
});

const linkSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  provider: z.enum(["slack", "linear", "jira", "gitlab", "github"]),
  entityType: z.string(),
  entityId: z.string(),
  externalRef: z.string(),
  metadata: z.record(z.unknown()).default({})
});

const listSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  provider: z.string().optional()
});

const rotateConnectionSchema = z.object({
  orgId: z.string().uuid(),
  reason: z.string().optional(),
  credentials: z.record(z.unknown()).default({})
});

const unlinkConnectionSchema = z.object({
  orgId: z.string().uuid(),
  cascadeLinks: z.boolean().default(true)
});

const healthQuerySchema = z.object({
  orgId: z.string().uuid()
});

const connectionStatusQuerySchema = z.object({
  orgId: z.string().uuid()
});

const listLinksSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  provider: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional()
});

const unlinkLinkSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  provider: z.enum(["slack", "linear", "jira", "gitlab", "github"]),
  entityType: z.string(),
  entityId: z.string(),
  externalRef: z.string().optional()
});

const startOauthSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  provider: oauthProviderSchema,
  connectionId: z.string().uuid().optional(),
  returnPath: z.string().optional()
});

const callbackQuerySchema = z.object({
  state: z.string().min(20),
  code: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional()
});

const reauthorizeSchema = z.object({
  orgId: z.string().uuid(),
  returnPath: z.string().optional()
});

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

function fingerprintCredentials(credentials: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(credentials)).digest("hex");
}

type OAuthTokenExchange = {
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  tokenType?: string;
  expiresIn?: number;
  raw: Record<string, unknown>;
};

type WorkspaceProbe = {
  externalWorkspaceId: string;
  oauthMetadata: Record<string, unknown>;
};

const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000;

@Controller("integrations")
export class IntegrationsController {
  private readonly env = readEnv();

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("queue.analytics.rollup") private readonly analyticsQueue: Queue
  ) {}

  @Roles("owner", "admin")
  @Post("connections")
  async createConnection(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = connectionSchema.parse(body);

    const connection = await this.prisma.integrationConnection.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        provider: input.provider,
        authType: "manual",
        externalWorkspaceId: input.externalWorkspaceId,
        encryptedCredentials: encryptCredentials(input.credentials, this.env.integrationsEncryptionKey),
        credentialVersion: 1,
        lastRotatedAt: new Date(),
        lastHealthStatus: "unknown",
        lastHealthCheckedAt: null,
        status: "active",
        createdBy: user.userId
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: input.orgId,
      projectId: input.projectId,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "integration.connection_created",
      entityType: "integration_connection",
      entityId: connection.id,
      payload: {
        provider: input.provider,
        authType: "manual"
      }
    });

    await this.analyticsQueue.add("rollup", {
      orgId: input.orgId,
      projectId: input.projectId,
      source: "integration_connected",
      provider: input.provider
    }, reliableQueueOptions);

    return {
      id: connection.id,
      orgId: connection.orgId,
      projectId: connection.projectId,
      provider: connection.provider,
      status: connection.status,
      createdAt: connection.createdAt
    };
  }

  @Roles("owner", "admin")
  @Post("connections/:id/rotate")
  async rotateConnection(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthContext
  ) {
    const input = rotateConnectionSchema.parse(body);

    const existing = await this.prisma.integrationConnection.findUnique({
      where: {
        id
      }
    });

    if (!existing || existing.orgId !== input.orgId) {
      return {
        rotated: false,
        reason: "connection_not_found"
      };
    }

    const previousFingerprint = fingerprintCredentials(
      decryptCredentials(existing.encryptedCredentials, this.env.integrationsEncryptionKey)
    );
    const nextFingerprint = fingerprintCredentials(input.credentials);

    const updated = await this.prisma.integrationConnection.update({
      where: {
        id
      },
      data: {
        encryptedCredentials: encryptCredentials(input.credentials, this.env.integrationsEncryptionKey),
        credentialVersion: existing.credentialVersion + 1,
        lastRotatedAt: new Date(),
        status: "active",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastErrorAt: null
      }
    });

    await this.prisma.integrationCredentialRotation.create({
      data: {
        connectionId: updated.id,
        rotatedBy: user.userId,
        previousFingerprint,
        nextFingerprint,
        reason: input.reason
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: updated.orgId,
      projectId: updated.projectId ?? undefined,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "integration.credentials_rotated",
      entityType: "integration_connection",
      entityId: updated.id,
      payload: {
        provider: updated.provider,
        reason: input.reason ?? null,
        credentialVersion: updated.credentialVersion
      }
    });

    await this.analyticsQueue.add("rollup", {
      orgId: updated.orgId,
      projectId: updated.projectId,
      source: "integration_credentials_rotated",
      provider: updated.provider
    }, reliableQueueOptions);

    return {
      id: updated.id,
      orgId: updated.orgId,
      provider: updated.provider,
      credentialVersion: updated.credentialVersion,
      lastRotatedAt: updated.lastRotatedAt
    };
  }

  @Roles("owner", "admin")
  @Post("connections/:id/unlink")
  async unlinkConnection(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = unlinkConnectionSchema.parse(body);

    const connection = await this.prisma.integrationConnection.findUnique({
      where: {
        id
      }
    });

    if (!connection || connection.orgId !== input.orgId) {
      return {
        unlinked: false,
        reason: "connection_not_found"
      };
    }

    const [updatedConnection, linksResult] = await this.prisma.$transaction([
      this.prisma.integrationConnection.update({
        where: {
          id
        },
        data: {
          status: "inactive",
          lastHealthStatus: "unlinked",
          lastHealthCheckedAt: new Date()
        }
      }),
      input.cascadeLinks
        ? this.prisma.integrationLink.deleteMany({
            where: {
              orgId: input.orgId,
              projectId: connection.projectId,
              provider: connection.provider
            }
          })
        : this.prisma.integrationLink.deleteMany({
            where: {
              id: {
                in: []
              }
            }
          })
    ]);

    await this.analyticsQueue.add("rollup", {
      orgId: updatedConnection.orgId,
      projectId: updatedConnection.projectId,
      source: "integration_unlinked",
      provider: updatedConnection.provider
    }, reliableQueueOptions);

    await appendAuditLog({
      prisma: this.prisma,
      orgId: updatedConnection.orgId,
      projectId: updatedConnection.projectId ?? undefined,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "integration.connection_unlinked",
      entityType: "integration_connection",
      entityId: updatedConnection.id,
      payload: {
        provider: updatedConnection.provider,
        linksRemoved: linksResult.count
      }
    });

    return {
      unlinked: true,
      id: updatedConnection.id,
      provider: updatedConnection.provider,
      status: updatedConnection.status,
      linksRemoved: linksResult.count
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get("connections/:id/health")
  async connectionHealth(@Param("id") id: string, @Query() query: Record<string, unknown>) {
    const input = healthQuerySchema.parse(query);

    const connection = await this.prisma.integrationConnection.findUnique({
      where: {
        id
      }
    });

    if (!connection || connection.orgId !== input.orgId) {
      return {
        healthy: false,
        status: "missing",
        reason: "connection_not_found"
      };
    }

    const credentials = decryptCredentials(connection.encryptedCredentials, this.env.integrationsEncryptionKey);
    const hasCredentials = Object.keys(credentials).length > 0;
    const status =
      connection.status !== "active"
        ? "inactive"
        : hasCredentials
          ? "healthy"
          : "degraded";

    await this.prisma.integrationConnection.update({
      where: {
        id: connection.id
      },
      data: {
        lastHealthStatus: status,
        lastHealthCheckedAt: new Date()
      }
    });

    return {
      id: connection.id,
      provider: connection.provider,
      healthy: status === "healthy",
      status,
      checkedAt: new Date().toISOString()
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get("connections")
  async listConnections(@Query() query: Record<string, unknown>) {
    const input = listSchema.parse(query);

    const connections = await this.prisma.integrationConnection.findMany({
      where: {
        orgId: input.orgId,
        projectId: input.projectId,
        provider: input.provider
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return connections.map((connection) => ({
      id: connection.id,
      orgId: connection.orgId,
      projectId: connection.projectId,
      provider: connection.provider,
      authType: connection.authType,
      externalWorkspaceId: connection.externalWorkspaceId,
      status: connection.status,
      credentialVersion: connection.credentialVersion,
      lastRotatedAt: connection.lastRotatedAt,
      lastHealthStatus: connection.lastHealthStatus,
      lastHealthCheckedAt: connection.lastHealthCheckedAt,
      tokenExpiresAt: connection.tokenExpiresAt,
      refreshExpiresAt: connection.refreshExpiresAt,
      lastErrorCode: connection.lastErrorCode,
      lastErrorMessage: connection.lastErrorMessage,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt
    }));
  }

  @Roles("owner", "admin")
  @Post("oauth/start")
  async startOauth(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = startOauthSchema.parse(body);
    return this.startOauthFlow(input, user);
  }

  @Public()
  @Get("oauth/:provider/callback")
  async oauthCallback(
    @Param("provider") provider: string,
    @Query() query: Record<string, unknown>,
    @Res() reply: { redirect: (url: string) => unknown }
  ) {
    const parsedProvider = oauthProviderSchema.safeParse(provider);
    if (!parsedProvider.success) {
      return reply.redirect(this.buildReturnUrl(undefined, "error", provider, "unsupported_provider"));
    }

    const input = callbackQuerySchema.safeParse(query);
    if (!input.success) {
      return reply.redirect(this.buildReturnUrl(undefined, "error", parsedProvider.data, "invalid_callback_query"));
    }

    const oauthSession = await this.prisma.integrationOauthSession.findUnique({
      where: {
        state: input.data.state
      },
      include: {
        connection: true
      }
    });

    if (!oauthSession || oauthSession.provider !== parsedProvider.data || oauthSession.status !== "pending") {
      return reply.redirect(this.buildReturnUrl(undefined, "error", parsedProvider.data, "invalid_state"));
    }

    if (oauthSession.expiresAt.getTime() < Date.now()) {
      await this.failOauthSession(
        oauthSession,
        "expired_state",
        "The OAuth state expired before callback completion."
      );
      return reply.redirect(
        this.buildReturnUrl(oauthSession.returnUrl ?? undefined, "error", parsedProvider.data, "expired_state")
      );
    }

    if (input.data.error) {
      await this.failOauthSession(
        oauthSession,
        input.data.error,
        input.data.error_description ?? "Provider rejected authorization request."
      );
      return reply.redirect(
        this.buildReturnUrl(
          oauthSession.returnUrl ?? undefined,
          "error",
          parsedProvider.data,
          input.data.error
        )
      );
    }

    if (!input.data.code) {
      await this.failOauthSession(oauthSession, "missing_code", "OAuth callback missing authorization code.");
      return reply.redirect(
        this.buildReturnUrl(oauthSession.returnUrl ?? undefined, "error", parsedProvider.data, "missing_code")
      );
    }

    try {
      const redirectUri = this.buildRedirectUri(parsedProvider.data);
      const exchange = await this.exchangeOAuthCode(parsedProvider.data, input.data.code, redirectUri);
      const workspace = await this.resolveWorkspace(parsedProvider.data, exchange.accessToken, exchange.raw);

      const existingConnection = oauthSession.connection;
      const previousCredentials = decryptCredentials(
        existingConnection.encryptedCredentials,
        this.env.integrationsEncryptionKey
      );
      const previousFingerprint = fingerprintCredentials(previousCredentials);
      const nextCredentialPayload = {
        accessToken: exchange.accessToken,
        refreshToken: exchange.refreshToken ?? null,
        tokenType: exchange.tokenType ?? "Bearer",
        scope: exchange.scope ?? null,
        provider: parsedProvider.data,
        issuedAt: new Date().toISOString(),
        workspace: workspace.oauthMetadata
      };
      const nextFingerprint = fingerprintCredentials(nextCredentialPayload);

      const tokenExpiresAt =
        typeof exchange.expiresIn === "number" && exchange.expiresIn > 0
          ? new Date(Date.now() + exchange.expiresIn * 1000)
          : null;

      const connection = await this.prisma.integrationConnection.update({
        where: {
          id: existingConnection.id
        },
        data: {
          status: "active",
          authType: "oauth",
          externalWorkspaceId: workspace.externalWorkspaceId,
          encryptedCredentials: encryptCredentials(nextCredentialPayload, this.env.integrationsEncryptionKey),
          oauthScopes: toJson(exchange.scope ? exchange.scope.split(/[,\s]+/).filter(Boolean) : []),
          oauthMetadata: toJson(workspace.oauthMetadata),
          tokenExpiresAt,
          refreshExpiresAt: null,
          credentialVersion: existingConnection.credentialVersion + 1,
          lastRotatedAt: new Date(),
          lastHealthStatus: "healthy",
          lastHealthCheckedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorAt: null
        }
      });

      await this.prisma.integrationCredentialRotation.create({
        data: {
          connectionId: connection.id,
          rotatedBy: oauthSession.initiatedBy ?? undefined,
          previousFingerprint,
          nextFingerprint,
          reason: "oauth_callback"
        }
      });

      await this.prisma.integrationOauthSession.update({
        where: {
          id: oauthSession.id
        },
        data: {
          status: "completed",
          consumedAt: new Date(),
          failureReason: null
        }
      });

      await appendAuditLog({
        prisma: this.prisma,
        orgId: connection.orgId,
        projectId: connection.projectId ?? undefined,
        actorUserId: oauthSession.initiatedBy ?? undefined,
        actorType: "user",
        eventType: "integration.oauth_connected",
        entityType: "integration_connection",
        entityId: connection.id,
        payload: {
          provider: parsedProvider.data,
          externalWorkspaceId: connection.externalWorkspaceId,
          status: connection.status
        }
      });

      await this.analyticsQueue.add("rollup", {
        orgId: connection.orgId,
        projectId: connection.projectId,
        source: "integration_oauth_connected",
        provider: connection.provider
      }, reliableQueueOptions);

      return reply.redirect(
        this.buildReturnUrl(
          oauthSession.returnUrl ?? undefined,
          "success",
          parsedProvider.data,
          undefined,
          connection.id
        )
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "oauth_callback_failed";
      await this.failOauthSession(oauthSession, "oauth_exchange_failed", reason);
      return reply.redirect(
        this.buildReturnUrl(
          oauthSession.returnUrl ?? undefined,
          "error",
          parsedProvider.data,
          "oauth_exchange_failed"
        )
      );
    }
  }

  @Roles("owner", "admin")
  @Post("connections/:id/reauthorize")
  async reauthorizeConnection(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthContext
  ) {
    const input = reauthorizeSchema.parse(body);
    const connection = await this.prisma.integrationConnection.findUnique({
      where: {
        id
      }
    });

    if (!connection || connection.orgId !== input.orgId) {
      return {
        started: false,
        reason: "connection_not_found"
      };
    }

    const parsedProvider = oauthProviderSchema.safeParse(connection.provider);
    if (!parsedProvider.success) {
      return {
        started: false,
        reason: "provider_not_oauth_enabled"
      };
    }

    return this.startOauthFlow(
      {
        orgId: input.orgId,
        projectId: connection.projectId ?? undefined,
        provider: parsedProvider.data,
        connectionId: connection.id,
        returnPath: input.returnPath
      },
      user
    );
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get("connections/:id/status")
  async connectionStatus(@Param("id") id: string, @Query() query: Record<string, unknown>) {
    const input = connectionStatusQuerySchema.parse(query);

    const connection = await this.prisma.integrationConnection.findUnique({
      where: {
        id
      }
    });

    if (!connection || connection.orgId !== input.orgId) {
      return {
        status: "missing",
        healthy: false,
        requiresReauth: false,
        reason: "connection_not_found"
      };
    }

    const now = Date.now();
    const credentials = decryptCredentials(connection.encryptedCredentials, this.env.integrationsEncryptionKey);
    const hasCredentials = Object.keys(credentials).length > 0;
    const tokenExpired = Boolean(connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() < now);

    let status = connection.status;
    if (status === "pending_auth") {
      const pending = await this.prisma.integrationOauthSession.findFirst({
        where: {
          connectionId: connection.id,
          status: "pending"
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      if (!pending) {
        status = "error";
      } else if (pending.expiresAt.getTime() < now) {
        status = "expired";
      }
    } else if (status === "active" && tokenExpired) {
      status = "expired";
    } else if (status === "active" && connection.lastHealthStatus === "degraded") {
      status = "degraded";
    }

    return {
      id: connection.id,
      provider: connection.provider,
      status,
      healthy: status === "active" && hasCredentials,
      requiresReauth: status === "expired" || status === "error",
      credentialVersion: connection.credentialVersion,
      tokenExpiresAt: connection.tokenExpiresAt,
      lastHealthStatus: connection.lastHealthStatus,
      lastHealthCheckedAt: connection.lastHealthCheckedAt,
      lastErrorCode: connection.lastErrorCode,
      lastErrorMessage: connection.lastErrorMessage,
      checkedAt: new Date().toISOString()
    };
  }

  @Roles("owner", "admin", "member")
  @Post("links")
  async createLink(@Body() body: unknown) {
    const input = linkSchema.parse(body);

    const link = await this.prisma.integrationLink.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        entityType: input.entityType,
        entityId: input.entityId,
        provider: input.provider,
        externalRef: input.externalRef,
        metadata: toJson(input.metadata)
      }
    });

    await this.analyticsQueue.add("rollup", {
      orgId: input.orgId,
      projectId: input.projectId,
      source: "integration_link_created",
      provider: input.provider,
      entityType: input.entityType
    }, reliableQueueOptions);

    return link;
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get("links")
  async listLinks(@Query() query: Record<string, unknown>) {
    const input = listLinksSchema.parse(query);

    return this.prisma.integrationLink.findMany({
      where: {
        orgId: input.orgId,
        projectId: input.projectId,
        provider: input.provider,
        entityType: input.entityType,
        entityId: input.entityId
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  }

  @Roles("owner", "admin", "member")
  @Post("links/unlink")
  async unlinkLink(@Body() body: unknown) {
    const input = unlinkLinkSchema.parse(body);

    const deleted = await this.prisma.integrationLink.deleteMany({
      where: {
        orgId: input.orgId,
        projectId: input.projectId,
        provider: input.provider,
        entityType: input.entityType,
        entityId: input.entityId,
        externalRef: input.externalRef
      }
    });

    await this.analyticsQueue.add("rollup", {
      orgId: input.orgId,
      projectId: input.projectId,
      source: "integration_link_removed",
      provider: input.provider,
      entityType: input.entityType
    }, reliableQueueOptions);

    return {
      removed: deleted.count
    };
  }

  private async startOauthFlow(
    input: z.infer<typeof startOauthSchema>,
    user: AuthContext
  ) {
    await this.assertProjectScope(input.orgId, input.projectId);
    const providerConfig = this.getProviderConfig(input.provider);
    const redirectUri = this.buildRedirectUri(input.provider);
    const expiresAt = new Date(Date.now() + OAUTH_SESSION_TTL_MS);
    const returnUrl = this.buildReturnUrl(input.returnPath, undefined, input.provider);

    const existingConnection = input.connectionId
      ? await this.prisma.integrationConnection.findUnique({
          where: {
            id: input.connectionId
          }
        })
      : null;

    if (existingConnection && existingConnection.orgId !== input.orgId) {
      throw new BadRequestException("connectionId does not belong to orgId");
    }

    if (existingConnection && existingConnection.provider !== input.provider) {
      throw new BadRequestException("connectionId provider does not match requested provider");
    }

    const connection =
      existingConnection ??
      (await this.prisma.integrationConnection.create({
        data: {
          orgId: input.orgId,
          projectId: input.projectId,
          provider: input.provider,
          authType: "oauth",
          encryptedCredentials: toJson({}),
          credentialVersion: 0,
          lastRotatedAt: null,
          lastHealthStatus: "unknown",
          lastHealthCheckedAt: null,
          status: "pending_auth",
          createdBy: user.userId
        }
      }));

    if (existingConnection) {
      await this.prisma.integrationConnection.update({
        where: {
          id: existingConnection.id
        },
        data: {
          status: "pending_auth",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorAt: null
        }
      });
    }

    const state = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

    await this.prisma.integrationOauthSession.create({
      data: {
        state,
        provider: input.provider,
        orgId: input.orgId,
        projectId: input.projectId,
        connectionId: connection.id,
        initiatedBy: user.userId,
        redirectUri,
        returnUrl,
        status: "pending",
        expiresAt
      }
    });

    const authorizeUrl = this.buildAuthorizeUrl(input.provider, providerConfig, {
      state,
      redirectUri
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: input.orgId,
      projectId: input.projectId,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "integration.oauth_started",
      entityType: "integration_connection",
      entityId: connection.id,
      payload: {
        provider: input.provider,
        returnUrl
      }
    });

    return {
      started: true,
      connectionId: connection.id,
      provider: input.provider,
      status: "pending_auth",
      authorizeUrl,
      expiresAt: expiresAt.toISOString()
    };
  }

  private async failOauthSession(
    session: {
      id: string;
      orgId: string;
      projectId: string | null;
      connectionId: string;
      initiatedBy: string | null;
    },
    code: string,
    message: string
  ) {
    await this.prisma.$transaction([
      this.prisma.integrationOauthSession.update({
        where: {
          id: session.id
        },
        data: {
          status: "failed",
          consumedAt: new Date(),
          failureReason: `${code}:${message}`.slice(0, 500)
        }
      }),
      this.prisma.integrationConnection.update({
        where: {
          id: session.connectionId
        },
        data: {
          status: "error",
          lastErrorCode: code.slice(0, 120),
          lastErrorMessage: message.slice(0, 500),
          lastErrorAt: new Date()
        }
      })
    ]);

    await appendAuditLog({
      prisma: this.prisma,
      orgId: session.orgId,
      projectId: session.projectId ?? undefined,
      actorUserId: session.initiatedBy ?? undefined,
      actorType: "user",
      eventType: "integration.oauth_failed",
      entityType: "integration_connection",
      entityId: session.connectionId,
      payload: {
        code,
        message
      }
    });
  }

  private buildAuthorizeUrl(
    provider: OAuthProvider,
    providerConfig: { clientId: string; scopes: string },
    context: { state: string; redirectUri: string }
  ): string {
    if (provider === "slack") {
      const url = new URL("https://slack.com/oauth/v2/authorize");
      url.searchParams.set("client_id", providerConfig.clientId);
      url.searchParams.set("scope", providerConfig.scopes.split(/\s+/).filter(Boolean).join(","));
      url.searchParams.set("redirect_uri", context.redirectUri);
      url.searchParams.set("state", context.state);
      return url.toString();
    }

    if (provider === "linear") {
      const url = new URL("https://linear.app/oauth/authorize");
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", providerConfig.clientId);
      url.searchParams.set("redirect_uri", context.redirectUri);
      url.searchParams.set("scope", providerConfig.scopes);
      url.searchParams.set("state", context.state);
      return url.toString();
    }

    const url = new URL("https://auth.atlassian.com/authorize");
    url.searchParams.set("audience", "api.atlassian.com");
    url.searchParams.set("client_id", providerConfig.clientId);
    url.searchParams.set("scope", providerConfig.scopes);
    url.searchParams.set("redirect_uri", context.redirectUri);
    url.searchParams.set("state", context.state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("prompt", "consent");
    return url.toString();
  }

  private getProviderConfig(provider: OAuthProvider): {
    clientId: string;
    clientSecret: string;
    scopes: string;
  } {
    if (provider === "slack") {
      if (!this.env.slackClientId || !this.env.slackClientSecret) {
        throw new BadRequestException("Slack OAuth is not configured");
      }
      return {
        clientId: this.env.slackClientId,
        clientSecret: this.env.slackClientSecret,
        scopes: this.env.slackOauthScopes
      };
    }

    if (provider === "linear") {
      if (!this.env.linearClientId || !this.env.linearClientSecret) {
        throw new BadRequestException("Linear OAuth is not configured");
      }
      return {
        clientId: this.env.linearClientId,
        clientSecret: this.env.linearClientSecret,
        scopes: this.env.linearOauthScopes
      };
    }

    if (!this.env.jiraClientId || !this.env.jiraClientSecret) {
      throw new BadRequestException("Jira OAuth is not configured");
    }
    return {
      clientId: this.env.jiraClientId,
      clientSecret: this.env.jiraClientSecret,
      scopes: this.env.jiraOauthScopes
    };
  }

  private buildRedirectUri(provider: OAuthProvider): string {
    const baseUrl = this.env.apiPublicBaseUrl.replace(/\/$/, "");
    return `${baseUrl}/v1/integrations/oauth/${provider}/callback`;
  }

  private buildReturnUrl(
    returnPath: string | undefined,
    status: "success" | "error" | undefined,
    provider: string,
    reason?: string,
    connectionId?: string
  ): string {
    const baseUrl = this.env.webConsoleBaseUrl.replace(/\/$/, "");
    const isAbsoluteUrl = Boolean(returnPath && /^https?:\/\//.test(returnPath));
    const path =
      !returnPath || isAbsoluteUrl ? "/integrations" : returnPath.startsWith("/") ? returnPath : "/integrations";
    const url = isAbsoluteUrl ? new URL(returnPath as string) : new URL(`${baseUrl}${path}`);
    if (status) {
      url.searchParams.set("oauth", status);
      url.searchParams.set("provider", provider);
    }
    if (reason) {
      url.searchParams.set("reason", reason);
    }
    if (connectionId) {
      url.searchParams.set("connectionId", connectionId);
    }
    return url.toString();
  }

  private async assertProjectScope(orgId: string, projectId?: string) {
    if (!projectId) {
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

    if (!project || project.orgId !== orgId) {
      throw new BadRequestException("projectId must belong to orgId");
    }
  }

  private async exchangeOAuthCode(
    provider: OAuthProvider,
    code: string,
    redirectUri: string
  ): Promise<OAuthTokenExchange> {
    const providerConfig = this.getProviderConfig(provider);

    if (provider === "slack") {
      const response = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: providerConfig.clientId,
          client_secret: providerConfig.clientSecret,
          code,
          redirect_uri: redirectUri
        }).toString()
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok || payload.ok !== true || typeof payload.access_token !== "string") {
        throw new BadRequestException("Slack OAuth token exchange failed");
      }
      return {
        accessToken: payload.access_token,
        refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
        scope: typeof payload.scope === "string" ? payload.scope : undefined,
        tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
        expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : undefined,
        raw: payload
      };
    }

    if (provider === "linear") {
      const response = await fetch("https://api.linear.app/oauth/token", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: providerConfig.clientId,
          client_secret: providerConfig.clientSecret
        })
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok || typeof payload.access_token !== "string") {
        throw new BadRequestException("Linear OAuth token exchange failed");
      }
      return {
        accessToken: payload.access_token,
        refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
        scope: typeof payload.scope === "string" ? payload.scope : undefined,
        tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
        expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : undefined,
        raw: payload
      };
    }

    const response = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: providerConfig.clientId,
        client_secret: providerConfig.clientSecret,
        code,
        redirect_uri: redirectUri
      })
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok || typeof payload.access_token !== "string") {
      throw new BadRequestException("Jira OAuth token exchange failed");
    }

    return {
      accessToken: payload.access_token,
      refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
      scope: typeof payload.scope === "string" ? payload.scope : undefined,
      tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
      expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : undefined,
      raw: payload
    };
  }

  private async resolveWorkspace(
    provider: OAuthProvider,
    accessToken: string,
    exchangeRaw: Record<string, unknown>
  ): Promise<WorkspaceProbe> {
    if (provider === "slack") {
      const response = await fetch("https://slack.com/api/auth.test", {
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok || payload.ok !== true || typeof payload.team_id !== "string") {
        throw new BadRequestException("Slack workspace lookup failed");
      }

      return {
        externalWorkspaceId: payload.team_id,
        oauthMetadata: {
          teamName: typeof payload.team === "string" ? payload.team : null,
          userId: typeof payload.user_id === "string" ? payload.user_id : null,
          botUserId: typeof payload.bot_id === "string" ? payload.bot_id : null,
          exchange: exchangeRaw
        }
      };
    }

    if (provider === "linear") {
      const response = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          query: "query BranchlineOAuth { organization { id name urlKey } viewer { id email } }"
        })
      });
      const payload = (await response.json()) as Record<string, unknown>;
      const data = payload.data as Record<string, unknown> | undefined;
      const organization =
        data && typeof data === "object"
          ? (data.organization as Record<string, unknown> | undefined)
          : undefined;

      if (!response.ok || !organization || typeof organization.id !== "string") {
        throw new BadRequestException("Linear organization lookup failed");
      }

      const viewer =
        data && typeof data === "object" ? (data.viewer as Record<string, unknown> | undefined) : undefined;

      return {
        externalWorkspaceId: organization.id,
        oauthMetadata: {
          organizationName: typeof organization.name === "string" ? organization.name : null,
          organizationKey: typeof organization.urlKey === "string" ? organization.urlKey : null,
          viewerId: viewer && typeof viewer.id === "string" ? viewer.id : null,
          viewerEmail: viewer && typeof viewer.email === "string" ? viewer.email : null,
          exchange: exchangeRaw
        }
      };
    }

    const response = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const payload = (await response.json()) as unknown;
    const resources = Array.isArray(payload) ? payload : [];
    const first = (resources[0] ?? null) as Record<string, unknown> | null;
    if (!response.ok || !first || typeof first.id !== "string") {
      throw new BadRequestException("Jira cloud resource lookup failed");
    }

    return {
      externalWorkspaceId: first.id,
      oauthMetadata: {
        cloudName: typeof first.name === "string" ? first.name : null,
        cloudUrl: typeof first.url === "string" ? first.url : null,
        scopes: Array.isArray(first.scopes) ? first.scopes : [],
        exchange: exchangeRaw
      }
    };
  }
}
