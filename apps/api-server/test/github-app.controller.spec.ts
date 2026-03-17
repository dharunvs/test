import { createHmac } from "node:crypto";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { resetEnvCache } from "../src/common/env.js";
import type { PrismaService } from "../src/common/prisma.service.js";
import { GithubAppController } from "../src/modules/github-app/github-app.controller.js";

const WEBHOOK_SECRET = "branchline-test-webhook-secret";

function signPayload(rawBody: string): string {
  const digest = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  return `sha256=${digest}`;
}

describe("GithubAppController", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.GITHUB_APP_ID = "";
    process.env.GITHUB_APP_PRIVATE_KEY = "";
    resetEnvCache();
  });

  it("treats already-processed webhook deliveries as idempotent", async () => {
    const prisma = {
      githubWebhookDelivery: {
        findUnique: vi.fn().mockResolvedValue({
          id: "delivery-row",
          deliveryId: "delivery-1",
          processed: true,
          status: "processed",
          attemptCount: 1
        }),
        create: vi.fn(),
        update: vi.fn()
      }
    } as unknown as PrismaService;

    const controller = new GithubAppController(prisma);
    const rawBody = "{}";
    const result = await controller.webhook(
      {
        rawBody
      },
      "delivery-1",
      "push",
      signPayload(rawBody),
      {}
    );

    expect(result).toEqual({
      accepted: true,
      deliveryId: "delivery-1",
      eventName: "push",
      idempotent: true
    });
    expect(prisma.githubWebhookDelivery.create).not.toHaveBeenCalled();
    expect(prisma.githubWebhookDelivery.update).not.toHaveBeenCalled();
  });

  it("fails permanently on invalid webhook signature", async () => {
    const prisma = {
      githubWebhookDelivery: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "delivery-row"
        }),
        update: vi.fn().mockResolvedValue({
          id: "delivery-row"
        })
      }
    } as unknown as PrismaService;

    const controller = new GithubAppController(prisma);

    await expect(
      controller.webhook(
        {
          rawBody: "{}"
        },
        "delivery-2",
        "push",
        "sha256=invalid",
        {}
      )
    ).rejects.toThrow("Invalid webhook signature");

    expect(prisma.githubWebhookDelivery.create).toHaveBeenCalledOnce();
    expect(prisma.githubWebhookDelivery.update).toHaveBeenCalledWith(
      {
        where: {
          deliveryId: "delivery-2"
        },
        data: expect.objectContaining({
          status: "failed_permanent",
          error: "invalid_signature"
        })
      }
    );
  });

  it("schedules webhook retry when processing fails below max attempts", async () => {
    const prisma = {
      githubWebhookDelivery: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "delivery-row"
        }),
        update: vi.fn().mockResolvedValue({
          id: "delivery-row"
        })
      }
    } as unknown as PrismaService;

    const controller = new GithubAppController(prisma);
    vi.spyOn(controller as never, "handleWebhookEvent").mockRejectedValue(new Error("boom"));

    const rawBody = "{}";
    await expect(
      controller.webhook(
        {
          rawBody
        },
        "delivery-3",
        "pull_request",
        signPayload(rawBody),
        {}
      )
    ).rejects.toThrow("Failed to process webhook: boom");

    const finalUpdateCall = (prisma.githubWebhookDelivery.update as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(finalUpdateCall).toBeDefined();
    expect(finalUpdateCall?.[0]).toEqual(
      expect.objectContaining({
        where: {
          deliveryId: "delivery-3"
        },
        data: expect.objectContaining({
          status: "retry_scheduled",
          processed: false,
          error: "boom"
        })
      })
    );
    expect(finalUpdateCall?.[0].data.nextRetryAt).toBeInstanceOf(Date);
  });

  it("marks retries as permanently failed at max attempt count", async () => {
    const prisma = {
      githubWebhookDelivery: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "retry-delivery-1",
            deliveryId: "delivery-4",
            eventName: "check_run",
            payload: {},
            attemptCount: 4,
            processed: false,
            status: "retry_scheduled",
            nextRetryAt: new Date(Date.now() - 1_000),
            createdAt: new Date()
          }
        ]),
        update: vi.fn().mockResolvedValue({
          id: "retry-delivery-1"
        })
      }
    } as unknown as PrismaService;

    const controller = new GithubAppController(prisma);
    vi.spyOn(controller as never, "handleWebhookEvent").mockRejectedValue(new Error("retry-failure"));

    const result = await controller.retryPendingDeliveries({
      limit: 5
    });

    expect(result).toEqual({
      scanned: 1,
      succeeded: 0,
      failed: 1
    });

    const finalUpdateCall = (prisma.githubWebhookDelivery.update as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(finalUpdateCall?.[0]).toEqual(
      expect.objectContaining({
        where: {
          id: "retry-delivery-1"
        },
        data: expect.objectContaining({
          status: "failed_permanent",
          processed: false,
          nextRetryAt: null,
          error: "retry-failure"
        })
      })
    );
  });

  it("returns fail-closed reconciliation reason when app credentials are missing", async () => {
    const prisma = {} as PrismaService;
    const controller = new GithubAppController(prisma);

    const result = await controller.reconcilePullRequestState({});
    expect(result).toEqual({
      scanned: 0,
      reconciled: 0,
      failed: 0,
      skipped: 0,
      reason: "github_app_credentials_missing"
    });
  });
});
