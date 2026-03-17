import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "../src/common/env.js";
import type { PrismaService } from "../src/common/prisma.service.js";
import { IntegrationsController } from "../src/modules/integrations/integrations.controller.js";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

describe("IntegrationsController", () => {
  beforeEach(() => {
    process.env.SLACK_CLIENT_ID = "slack-client-id";
    process.env.SLACK_CLIENT_SECRET = "slack-client-secret";
    process.env.WEB_CONSOLE_BASE_URL = "http://localhost:3000";
    process.env.API_PUBLIC_BASE_URL = "http://localhost:4000";
    resetEnvCache();
  });

  it("sanitizes credentials from list connections response", async () => {
    const prisma = {
      integrationConnection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "22222222-2222-2222-2222-222222222222",
            orgId: ORG_ID,
            projectId: null,
            provider: "slack",
            authType: "manual",
            externalWorkspaceId: "workspace-1",
            encryptedCredentials: {
              token: "sensitive"
            },
            oauthScopes: null,
            oauthMetadata: null,
            tokenExpiresAt: null,
            refreshExpiresAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            lastErrorAt: null,
            credentialVersion: 2,
            lastRotatedAt: new Date(),
            lastHealthStatus: "healthy",
            lastHealthCheckedAt: new Date(),
            status: "active",
            createdBy: "33333333-3333-3333-3333-333333333333",
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ])
      }
    } as unknown as PrismaService;

    const queue = {
      add: vi.fn()
    };

    const controller = new IntegrationsController(prisma, queue as never);
    const result = await controller.listConnections({
      orgId: ORG_ID
    });

    expect(result).toHaveLength(1);
    expect((result[0] as Record<string, unknown>).encryptedCredentials).toBeUndefined();
    expect(result[0]?.credentialVersion).toBe(2);
  });

  it("starts oauth flow and returns authorize url", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue(null)
      },
      integrationConnection: {
        create: vi.fn().mockResolvedValue({
          id: "33333333-3333-3333-3333-333333333333",
          orgId: ORG_ID,
          projectId: null,
          provider: "slack",
          authType: "oauth",
          externalWorkspaceId: null,
          encryptedCredentials: {},
          oauthScopes: null,
          oauthMetadata: null,
          tokenExpiresAt: null,
          refreshExpiresAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorAt: null,
          credentialVersion: 0,
          lastRotatedAt: null,
          lastHealthStatus: "unknown",
          lastHealthCheckedAt: null,
          status: "pending_auth",
          createdBy: "user-1",
          createdAt: new Date(),
          updatedAt: new Date()
        })
      },
      integrationOauthSession: {
        create: vi.fn().mockResolvedValue({
          id: "44444444-4444-4444-4444-444444444444"
        })
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "audit-1"
        })
      }
    } as unknown as PrismaService;

    const queue = {
      add: vi.fn()
    };
    const controller = new IntegrationsController(prisma, queue as never);
    const result = await controller.startOauth(
      {
        orgId: ORG_ID,
        provider: "slack"
      },
      {
        userId: "user-1",
        clerkUserId: "clerk-user-1",
        email: "test@branchline.dev",
        role: "owner"
      }
    );

    expect(result.started).toBe(true);
    expect(result.status).toBe("pending_auth");
    expect(result.authorizeUrl).toContain("slack.com/oauth/v2/authorize");
    expect(prisma.integrationOauthSession.create).toHaveBeenCalledTimes(1);
  });

  it("redirects callback when oauth state is invalid", async () => {
    const prisma = {
      integrationOauthSession: {
        findUnique: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaService;
    const queue = {
      add: vi.fn()
    };
    const controller = new IntegrationsController(prisma, queue as never);
    const reply = {
      redirect: vi.fn().mockImplementation((url: string) => url)
    };

    const result = await controller.oauthCallback(
      "slack",
      {
        state: "12345678901234567890123456789012"
      },
      reply as never
    );

    expect(reply.redirect).toHaveBeenCalledOnce();
    expect(String(result)).toContain("oauth=error");
    expect(String(result)).toContain("reason=invalid_state");
  });

  it("marks status as expired when oauth token expiry is in the past", async () => {
    const prisma = {
      integrationConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: "33333333-3333-3333-3333-333333333333",
          orgId: ORG_ID,
          projectId: null,
          provider: "slack",
          authType: "oauth",
          externalWorkspaceId: "workspace-1",
          encryptedCredentials: {},
          oauthScopes: [],
          oauthMetadata: {},
          tokenExpiresAt: new Date(Date.now() - 60_000),
          refreshExpiresAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorAt: null,
          credentialVersion: 2,
          lastRotatedAt: new Date(),
          lastHealthStatus: "healthy",
          lastHealthCheckedAt: new Date(),
          status: "active",
          createdBy: "user-1",
          createdAt: new Date(),
          updatedAt: new Date()
        })
      }
    } as unknown as PrismaService;
    const queue = {
      add: vi.fn()
    };
    const controller = new IntegrationsController(prisma, queue as never);
    const result = await controller.connectionStatus("33333333-3333-3333-3333-333333333333", {
      orgId: ORG_ID
    });

    expect(result.status).toBe("expired");
    expect(result.requiresReauth).toBe(true);
  });
});
