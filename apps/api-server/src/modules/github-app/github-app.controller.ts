import { createHmac, timingSafeEqual } from "node:crypto";

import {
  InternalServerErrorException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { z } from "zod";
import { App } from "octokit";

import { readEnv } from "../../common/env.js";
import { toJson } from "../../common/json.js";
import { PrismaService } from "../../common/prisma.service.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Public } from "../auth/public.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";

const installationRepositorySchema = z.object({
  providerRepoId: z.coerce.string().min(1),
  owner: z.string().min(1),
  name: z.string().min(1),
  defaultBranch: z.string().default("main"),
  isPrivate: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
  projectId: z.string().uuid().optional()
});

const installationSyncSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  githubInstallationId: z.number().int().positive(),
  accountLogin: z.string().default("unknown"),
  accountType: z.string().default("Organization"),
  permissions: z.record(z.unknown()).default({}),
  repositories: z.array(installationRepositorySchema).default([])
});

const retryWebhookSchema = z.object({
  limit: z.number().int().positive().max(100).default(20)
});

const installationStatusQuerySchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional()
});

const reconcileSchema = z.object({
  orgId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(500).default(200)
});

type RepositoryInput = z.infer<typeof installationRepositorySchema>;

interface ParsedRepository {
  providerRepoId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  metadata: Record<string, unknown>;
}

type JsonRecord = Record<string, unknown>;
const WEBHOOK_MAX_ATTEMPTS = 5;

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as JsonRecord;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readDate(value: unknown): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function extractArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nextWebhookRetryAt(attemptCount: number): Date {
  const delaySeconds = Math.min(15 * 60, 2 ** Math.max(0, attemptCount - 1) * 15);
  return new Date(Date.now() + delaySeconds * 1000);
}

function parseRepository(payload: unknown): ParsedRepository | null {
  const repository = asRecord(payload);
  if (!repository) {
    return null;
  }

  const id = readString(repository.id) ?? readNumber(repository.id)?.toString();
  const owner = readString(asRecord(repository.owner)?.login) ?? readString(repository.owner);
  const name = readString(repository.name);
  if (!id || !owner || !name) {
    return null;
  }

  return {
    providerRepoId: id,
    owner,
    name,
    fullName: readString(repository.full_name) ?? `${owner}/${name}`,
    defaultBranch: readString(repository.default_branch) ?? "main",
    isPrivate: Boolean(repository.private),
    metadata: repository
  };
}

function mapGithubCheckStatus(status: string | undefined, conclusion: string | undefined) {
  if (conclusion) {
    if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") {
      return "passed" as const;
    }
    if (conclusion === "cancelled") {
      return "canceled" as const;
    }
    return "failed" as const;
  }

  if (status === "queued" || status === "requested" || status === "waiting" || status === "pending") {
    return "queued" as const;
  }

  if (status === "in_progress") {
    return "running" as const;
  }

  if (status === "completed") {
    return "running" as const;
  }

  return "queued" as const;
}

function mapPullRequestStatus(input: { state?: string; draft?: boolean; mergedAt?: string | null }) {
  if (input.mergedAt) {
    return "merged" as const;
  }
  if (input.state === "closed") {
    return "closed" as const;
  }
  if (input.draft) {
    return "draft" as const;
  }
  return "open" as const;
}

@Controller("github")
export class GithubAppController implements OnModuleInit, OnModuleDestroy {
  private readonly env = readEnv();
  private readonly logger = new Logger(GithubAppController.name);
  private reconcileTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (this.env.nodeEnv === "test" || this.env.githubReconcileIntervalSeconds <= 0) {
      return;
    }

    const intervalMs = this.env.githubReconcileIntervalSeconds * 1000;
    this.reconcileTimer = setInterval(() => {
      void this.runScheduledReconciliation();
    }, intervalMs);

    this.logger.log(
      `Enabled scheduled GitHub reconciliation every ${this.env.githubReconcileIntervalSeconds}s`
    );
  }

  onModuleDestroy() {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  @Roles("owner", "admin")
  @Post("installations/sync")
  async syncInstallation(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = installationSyncSchema.parse(body);

    if (input.projectId) {
      const project = await this.prisma.project.findUnique({
        where: {
          id: input.projectId
        },
        select: {
          orgId: true
        }
      });

      if (!project || project.orgId !== input.orgId) {
        throw new BadRequestException("projectId must belong to orgId");
      }
    }

    const installation = await this.prisma.githubInstallation.upsert({
      where: {
        githubInstallationId: BigInt(input.githubInstallationId)
      },
      update: {
        orgId: input.orgId,
        accountLogin: input.accountLogin,
        accountType: input.accountType,
        permissions: toJson(input.permissions),
        installedByUserId: user.userId,
        installedAt: new Date(),
        uninstalledAt: null
      },
      create: {
        orgId: input.orgId,
        githubInstallationId: BigInt(input.githubInstallationId),
        accountLogin: input.accountLogin,
        accountType: input.accountType,
        permissions: toJson(input.permissions),
        installedByUserId: user.userId,
        installedAt: new Date()
      }
    });

    const repositoriesToSync =
      input.repositories.length > 0
        ? input.repositories.map((repository) => ({
            providerRepoId: repository.providerRepoId,
            owner: repository.owner,
            name: repository.name,
            fullName: `${repository.owner}/${repository.name}`,
            defaultBranch: repository.defaultBranch,
            isPrivate: repository.isPrivate,
            metadata: repository.metadata,
            projectId: repository.projectId
          }))
        : await this.fetchInstallationRepositories(input.githubInstallationId);

    const syncedRepositories: Array<{ id: string; fullName: string; projectId?: string }> = [];

    for (const repositoryInput of repositoriesToSync) {
      const targetProjectId = repositoryInput.projectId ?? input.projectId;

      const repository = await this.upsertRepositoryForOrg({
        orgId: input.orgId,
        projectId: targetProjectId,
        repository: {
          providerRepoId: repositoryInput.providerRepoId,
          owner: repositoryInput.owner,
          name: repositoryInput.name,
          fullName: repositoryInput.fullName,
          defaultBranch: repositoryInput.defaultBranch,
          isPrivate: repositoryInput.isPrivate,
          metadata: {
            ...repositoryInput.metadata,
            githubInstallationId: input.githubInstallationId
          }
        }
      });

      syncedRepositories.push({
        id: repository.id,
        fullName: repository.fullName,
        projectId: targetProjectId
      });
    }

    return {
      id: installation.id,
      orgId: installation.orgId,
      githubInstallationId: Number(installation.githubInstallationId),
      accountLogin: installation.accountLogin,
      syncedAt: installation.updatedAt,
      repositoriesSynced: syncedRepositories.length,
      repositories: syncedRepositories
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get("installations/status")
  async installationStatus(@Query() query: Record<string, unknown>) {
    const input = installationStatusQuerySchema.parse(query);

    const installations = await this.prisma.githubInstallation.findMany({
      where: {
        orgId: input.orgId
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    const projectRepositoryScope = input.projectId
      ? await this.prisma.projectRepository.findMany({
          where: {
            projectId: input.projectId
          },
          select: {
            repositoryId: true
          }
        })
      : [];

    const scopedRepositoryIds = new Set(projectRepositoryScope.map((row) => row.repositoryId));

    const repositories = await this.prisma.repository.findMany({
      where: {
        orgId: input.orgId,
        provider: "github"
      },
      select: {
        id: true,
        fullName: true,
        defaultBranch: true,
        metadata: true
      },
      orderBy: {
        fullName: "asc"
      }
    });

    const filteredRepositories =
      input.projectId && scopedRepositoryIds.size > 0
        ? repositories.filter((repository) => scopedRepositoryIds.has(repository.id))
        : input.projectId
          ? []
          : repositories;

    return {
      orgId: input.orgId,
      projectId: input.projectId,
      installations: installations.map((installation) => ({
        id: installation.id,
        githubInstallationId: Number(installation.githubInstallationId),
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        installedAt: installation.installedAt,
        uninstalledAt: installation.uninstalledAt,
        updatedAt: installation.updatedAt
      })),
      repositories: filteredRepositories.map((repository) => ({
        id: repository.id,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
        githubInstallationId:
          readNumber(asRecord(repository.metadata)?.githubInstallationId) ?? null
      })),
      repositoryCount: filteredRepositories.length
    };
  }

  @Public()
  @Post("webhooks")
  @HttpCode(202)
  async webhook(
    @Req()
    request: {
      rawBody?: Buffer | string;
      headers?: Record<string, string | string[] | undefined>;
    },
    @Headers("x-github-delivery") deliveryIdHeader: string | undefined,
    @Headers("x-github-event") eventNameHeader: string | undefined,
    @Headers("x-hub-signature-256") signatureHeader: string | undefined,
    @Body() payload: unknown
  ) {
    const readHeader = (name: string) => {
      const value = request.headers?.[name];
      if (Array.isArray(value)) {
        return value.find((entry) => typeof entry === "string" && entry.length > 0);
      }
      return typeof value === "string" && value.length > 0 ? value : undefined;
    };

    const deliveryId = deliveryIdHeader ?? readHeader("x-github-delivery");
    const eventName = eventNameHeader ?? readHeader("x-github-event");
    const signature =
      signatureHeader ??
      readHeader("x-hub-signature-256") ??
      readHeader("x-hub-signature");

    if (!deliveryId || !eventName) {
      throw new BadRequestException("Missing GitHub delivery headers");
    }

    const rawBody = this.resolveRawBody(request.rawBody, payload);
    const signatureValid = this.isSignatureValid(rawBody, payload, signature);
    const orgId = await this.resolveOrgId(payload);

    const existingDelivery = await this.prisma.githubWebhookDelivery.findUnique({
      where: {
        deliveryId
      }
    });

    if (existingDelivery?.processed) {
      return {
        accepted: true,
        deliveryId,
        eventName,
        idempotent: true
      };
    }

    if (
      existingDelivery &&
      existingDelivery.status === "failed_permanent" &&
      existingDelivery.attemptCount >= WEBHOOK_MAX_ATTEMPTS
    ) {
      return {
        accepted: false,
        deliveryId,
        eventName,
        reason: "delivery_marked_failed_permanently"
      };
    }

    const currentAttempt = (existingDelivery?.attemptCount ?? 0) + 1;

    if (existingDelivery) {
      await this.prisma.githubWebhookDelivery.update({
        where: {
          deliveryId
        },
        data: {
          orgId: orgId ?? existingDelivery.orgId,
          eventName,
          signatureValid,
          payload: toJson(payload),
          status: "processing",
          attemptCount: currentAttempt,
          nextRetryAt: null,
          processed: false,
          processedAt: null,
          error: null
        }
      });
    } else {
      await this.prisma.githubWebhookDelivery.create({
        data: {
          orgId,
          deliveryId,
          eventName,
          signatureValid,
          payload: toJson(payload),
          status: "processing",
          attemptCount: 1,
          nextRetryAt: null,
          processed: false,
          error: null
        }
      });
    }

    if (!signatureValid) {
      await this.prisma.githubWebhookDelivery.update({
        where: {
          deliveryId
        },
        data: {
          status: "failed_permanent",
          processed: false,
          processedAt: null,
          nextRetryAt: null,
          error: "invalid_signature"
        }
      });
      throw new UnauthorizedException("Invalid webhook signature");
    }

    try {
      await this.handleWebhookEvent(eventName, payload);
      await this.prisma.githubWebhookDelivery.update({
        where: {
          deliveryId
        },
        data: {
          status: "processed",
          processed: true,
          processedAt: new Date(),
          nextRetryAt: null,
          error: null
        }
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "webhook_processing_failed";
      const shouldRetry = currentAttempt < WEBHOOK_MAX_ATTEMPTS;
      await this.prisma.githubWebhookDelivery.update({
        where: {
          deliveryId
        },
        data: {
          status: shouldRetry ? "retry_scheduled" : "failed_permanent",
          nextRetryAt: shouldRetry ? nextWebhookRetryAt(currentAttempt) : null,
          processed: false,
          processedAt: null,
          error: reason.slice(0, 400)
        }
      });
      throw new BadRequestException(`Failed to process webhook: ${reason}`);
    }

    return {
      accepted: true,
      deliveryId,
      eventName,
      signatureValid: true
    };
  }

  @Roles("owner", "admin")
  @Post("webhooks/retry")
  async retryPendingDeliveries(@Body() body: unknown) {
    const input = retryWebhookSchema.parse(body);

    const deliveries = await this.prisma.githubWebhookDelivery.findMany({
      where: {
        status: "retry_scheduled",
        processed: false,
        nextRetryAt: {
          lte: new Date()
        }
      },
      orderBy: {
        createdAt: "asc"
      },
      take: input.limit
    });

    let succeeded = 0;
    let failed = 0;

    for (const delivery of deliveries) {
      const currentAttempt = delivery.attemptCount + 1;
      await this.prisma.githubWebhookDelivery.update({
        where: {
          id: delivery.id
        },
        data: {
          status: "processing",
          attemptCount: currentAttempt,
          nextRetryAt: null,
          error: null
        }
      });

      try {
        await this.handleWebhookEvent(delivery.eventName, delivery.payload);
        await this.prisma.githubWebhookDelivery.update({
          where: {
            id: delivery.id
          },
          data: {
            status: "processed",
            processed: true,
            processedAt: new Date(),
            nextRetryAt: null,
            error: null
          }
        });
        succeeded += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "webhook_retry_failed";
        const shouldRetry = currentAttempt < WEBHOOK_MAX_ATTEMPTS;
        await this.prisma.githubWebhookDelivery.update({
          where: {
            id: delivery.id
          },
          data: {
            status: shouldRetry ? "retry_scheduled" : "failed_permanent",
            processed: false,
            processedAt: null,
            nextRetryAt: shouldRetry ? nextWebhookRetryAt(currentAttempt) : null,
            error: reason.slice(0, 400)
          }
        });
        failed += 1;
      }
    }

    return {
      scanned: deliveries.length,
      succeeded,
      failed
    };
  }

  @Roles("owner", "admin")
  @Post("reconcile")
  async reconcilePullRequestState(@Body() body: unknown) {
    const input = reconcileSchema.parse(body ?? {});
    return this.reconcilePullRequestStateInternal(input);
  }

  private async runScheduledReconciliation() {
    const result = await this.reconcilePullRequestStateInternal({
      limit: this.env.githubReconcileLimit
    });
    if (result.failed > 0 || result.reason) {
      this.logger.warn(
        `Scheduled GitHub reconciliation completed with issues: scanned=${result.scanned}, reconciled=${result.reconciled}, failed=${result.failed}, skipped=${result.skipped}, reason=${result.reason ?? "none"}`
      );
      return;
    }

    this.logger.debug(
      `Scheduled GitHub reconciliation completed: scanned=${result.scanned}, reconciled=${result.reconciled}, skipped=${result.skipped}`
    );
  }

  private async reconcilePullRequestStateInternal(input: z.infer<typeof reconcileSchema>) {
    if (!this.env.githubAppId || !this.env.githubAppPrivateKey) {
      return {
        scanned: 0,
        reconciled: 0,
        failed: 0,
        skipped: 0,
        reason: "github_app_credentials_missing" as const
      };
    }

    const pullRequests = await this.prisma.pullRequest.findMany({
      where: {
        status: {
          in: ["open", "draft"]
        },
        branch: {
          orgId: input.orgId,
          projectId: input.projectId
        }
      },
      include: {
        branch: true,
        repository: true
      },
      orderBy: {
        updatedAt: "asc"
      },
      take: input.limit
    });

    const app = new App({
      appId: this.env.githubAppId,
      privateKey: this.env.githubAppPrivateKey
    });
    const octokitByInstallation = new Map<number, { request: (route: string, params: Record<string, unknown>) => Promise<{ data: unknown }> }>();

    let reconciled = 0;
    let failed = 0;
    let skipped = 0;

    for (const pullRequest of pullRequests) {
      if (pullRequest.repository.provider !== "github") {
        skipped += 1;
        continue;
      }

      const installationId = await this.resolveInstallationIdForRepository({
        orgId: pullRequest.branch.orgId,
        repositoryMetadata: pullRequest.repository.metadata
      });

      if (!installationId) {
        skipped += 1;
        continue;
      }

      try {
        let octokit = octokitByInstallation.get(installationId);
        if (!octokit) {
          octokit = (await app.getInstallationOctokit(installationId)) as unknown as {
            request: (route: string, params: Record<string, unknown>) => Promise<{ data: unknown }>;
          };
          octokitByInstallation.set(installationId, octokit);
        }

        const response = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
          owner: pullRequest.repository.owner,
          repo: pullRequest.repository.name,
          pull_number: pullRequest.number
        });

        const remote = asRecord(response.data);
        const remoteStatus = mapPullRequestStatus({
          state: readString(remote?.state),
          draft: Boolean(remote?.draft),
          mergedAt: readString(remote?.merged_at)
        });

        await this.prisma.pullRequest.update({
          where: {
            id: pullRequest.id
          },
          data: {
            status: remoteStatus,
            isDraft: Boolean(remote?.draft),
            mergeableState: readString(remote?.mergeable_state),
            mergedBy: readString(asRecord(remote?.merged_by)?.login),
            mergedAt: readDate(remote?.merged_at)
          }
        });

        if (remoteStatus === "merged") {
          await this.prisma.branch.update({
            where: {
              id: pullRequest.branchId
            },
            data: {
              status: "merged",
              mergedAt: readDate(remote?.merged_at) ?? new Date()
            }
          });
        } else if (remoteStatus === "closed") {
          await this.prisma.branch.update({
            where: {
              id: pullRequest.branchId
            },
            data: {
              status: "closed",
              closedAt: new Date()
            }
          });
        }

        reconciled += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      scanned: pullRequests.length,
      reconciled,
      failed,
      skipped
    };
  }

  private resolveRawBody(rawBody: Buffer | string | undefined, payload: unknown): string {
    if (Buffer.isBuffer(rawBody)) {
      return rawBody.toString("utf8");
    }

    if (typeof rawBody === "string") {
      return rawBody;
    }

    return JSON.stringify(payload ?? {});
  }

  private isSignatureValid(
    rawBody: string,
    payload: unknown,
    signature: string | undefined
  ): boolean {
    if (!signature) {
      return false;
    }

    const isExpectedMatch = (expectedBody: string) => {
      const digest = createHmac("sha256", this.env.githubWebhookSecret)
        .update(expectedBody)
        .digest("hex");
      const expected = `sha256=${digest}`;

      if (signature.length !== expected.length) {
        return false;
      }

      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    };

    if (isExpectedMatch(rawBody)) {
      return true;
    }

    // Some adapters may alter raw body formatting; validate against canonical JSON as fallback.
    const canonicalBody = JSON.stringify(payload ?? {});
    if (canonicalBody !== rawBody && isExpectedMatch(canonicalBody)) {
      return true;
    }

    return false;
  }

  private async resolveOrgId(payload: unknown): Promise<string | undefined> {
    const installationId = readNumber(asRecord(payload)?.installation && asRecord(asRecord(payload)?.installation)?.id);

    if (installationId) {
      const installation = await this.prisma.githubInstallation.findUnique({
        where: {
          githubInstallationId: BigInt(installationId)
        },
        select: {
          orgId: true
        }
      });

      if (installation) {
        return installation.orgId;
      }
    }

    const repository = parseRepository(asRecord(payload)?.repository);
    if (!repository) {
      return undefined;
    }

    const existingRepository = await this.prisma.repository.findUnique({
      where: {
        provider_providerRepoId: {
          provider: "github",
          providerRepoId: repository.providerRepoId
        }
      },
      select: {
        orgId: true
      }
    });

    return existingRepository?.orgId;
  }

  private async handleWebhookEvent(eventName: string, payload: unknown) {
    switch (eventName) {
      case "installation":
        await this.handleInstallationEvent(payload);
        return;
      case "installation_repositories":
        await this.handleInstallationRepositoriesEvent(payload);
        return;
      case "push":
        await this.handlePushEvent(payload);
        return;
      case "pull_request":
        await this.handlePullRequestEvent(payload);
        return;
      case "check_run":
      case "check_suite":
        await this.handleCheckEvent(eventName, payload);
        return;
      default:
        return;
    }
  }

  private async handleInstallationEvent(payload: unknown) {
    const root = asRecord(payload);
    const installation = asRecord(root?.installation);
    const installationId = readNumber(installation?.id);
    if (!installationId) {
      return;
    }

    const action = readString(root?.action) ?? "updated";
    const existing = await this.prisma.githubInstallation.findUnique({
      where: {
        githubInstallationId: BigInt(installationId)
      }
    });

    if (!existing) {
      return;
    }

    if (action === "deleted") {
      await this.prisma.githubInstallation.update({
        where: {
          githubInstallationId: BigInt(installationId)
        },
        data: {
          uninstalledAt: new Date()
        }
      });
      return;
    }

    const account = asRecord(installation?.account);
    await this.prisma.githubInstallation.update({
      where: {
        githubInstallationId: BigInt(installationId)
      },
      data: {
        accountLogin: readString(account?.login) ?? existing.accountLogin,
        accountType: readString(account?.type) ?? existing.accountType,
        permissions: toJson(asRecord(installation?.permissions) ?? (existing.permissions as JsonRecord)),
        uninstalledAt: null,
        installedAt: new Date()
      }
    });
  }

  private async handleInstallationRepositoriesEvent(payload: unknown) {
    const root = asRecord(payload);
    const installation = asRecord(root?.installation);
    const installationId = readNumber(installation?.id);
    if (!installationId) {
      return;
    }

    const githubInstallation = await this.prisma.githubInstallation.findUnique({
      where: {
        githubInstallationId: BigInt(installationId)
      }
    });

    if (!githubInstallation) {
      return;
    }

    const addedRepos = [
      ...extractArray(root?.repositories_added),
      ...extractArray(root?.added_repositories)
    ]
      .map((repositoryPayload) => parseRepository(repositoryPayload))
      .filter((repository): repository is ParsedRepository => Boolean(repository));

    for (const repository of addedRepos) {
      await this.upsertRepositoryForOrg({
        orgId: githubInstallation.orgId,
        repository: {
          ...repository,
          metadata: {
            ...repository.metadata,
            githubInstallationId: installationId
          }
        }
      });
    }

    const removedRepos = [
      ...extractArray(root?.repositories_removed),
      ...extractArray(root?.removed_repositories)
    ]
      .map((repositoryPayload) => parseRepository(repositoryPayload))
      .filter((repository): repository is ParsedRepository => Boolean(repository));

    for (const repository of removedRepos) {
      const existing = await this.prisma.repository.findUnique({
        where: {
          provider_providerRepoId: {
            provider: "github",
            providerRepoId: repository.providerRepoId
          }
        }
      });

      if (!existing) {
        continue;
      }

      await this.prisma.projectRepository.deleteMany({
        where: {
          repositoryId: existing.id
        }
      });

      await this.prisma.repository.update({
        where: {
          id: existing.id
        },
        data: {
          metadata: toJson({
            ...(asRecord(existing.metadata) ?? {}),
            githubAccessRevokedAt: new Date().toISOString(),
            githubInstallationId: installationId
          })
        }
      });
    }
  }

  private async handlePushEvent(payload: unknown) {
    const root = asRecord(payload);
    const repository = parseRepository(root?.repository);
    if (!repository) {
      return;
    }

    const orgId = await this.resolveRepositoryOrgId(repository.providerRepoId, root);
    const existingRepository = await this.prisma.repository.findUnique({
      where: {
        provider_providerRepoId: {
          provider: "github",
          providerRepoId: repository.providerRepoId
        }
      }
    });

    const syncedRepository = orgId
      ? await this.upsertRepositoryForOrg({
          orgId,
          repository
        })
      : existingRepository;

    if (!syncedRepository) {
      return;
    }

    const ref = readString(root?.ref);
    const headSha = readString(root?.after);
    if (!ref || !headSha || !ref.startsWith("refs/heads/")) {
      return;
    }

    const branchName = ref.replace("refs/heads/", "");
    await this.prisma.branch.updateMany({
      where: {
        repositoryId: syncedRepository.id,
        name: branchName,
        status: {
          in: ["active", "stale"]
        }
      },
      data: {
        headSha
      }
    });
  }

  private async handlePullRequestEvent(payload: unknown) {
    const root = asRecord(payload);
    const repository = parseRepository(root?.repository);
    const pullRequest = asRecord(root?.pull_request);
    if (!repository || !pullRequest) {
      return;
    }

    const orgId = await this.resolveRepositoryOrgId(repository.providerRepoId, root);
    const syncedRepository = orgId
      ? await this.upsertRepositoryForOrg({
          orgId,
          repository
        })
      : await this.prisma.repository.findUnique({
          where: {
            provider_providerRepoId: {
              provider: "github",
              providerRepoId: repository.providerRepoId
            }
          }
        });

    if (!syncedRepository) {
      return;
    }

    const number = readNumber(pullRequest.number) ?? readNumber(root?.number);
    const pullRequestId = readNumber(pullRequest.id);
    const headRef = readString(asRecord(pullRequest.head)?.ref);

    if (!number || !headRef) {
      return;
    }

    const branch = await this.prisma.branch.findFirst({
      where: {
        repositoryId: syncedRepository.id,
        name: headRef
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (!branch) {
      return;
    }

    const merged = Boolean(pullRequest.merged);
    const state = readString(pullRequest.state);
    const isDraft = Boolean(pullRequest.draft);

    const status = merged ? "merged" : state === "closed" ? "closed" : isDraft ? "draft" : "open";

    await this.prisma.pullRequest.upsert({
      where: {
        repositoryId_number: {
          repositoryId: syncedRepository.id,
          number
        }
      },
      update: {
        branchId: branch.id,
        providerPrId: pullRequestId ? String(pullRequestId) : String(number),
        url: readString(pullRequest.html_url) ?? `https://github.com/${repository.fullName}/pull/${number}`,
        title: readString(pullRequest.title) ?? `PR #${number}`,
        status,
        isDraft,
        mergeableState: readString(pullRequest.mergeable_state),
        openedBy: readString(asRecord(pullRequest.user)?.login),
        openedAt: readDate(pullRequest.created_at),
        mergedBy: readString(asRecord(pullRequest.merged_by)?.login),
        mergedAt: readDate(pullRequest.merged_at)
      },
      create: {
        orgId: branch.orgId,
        repositoryId: syncedRepository.id,
        branchId: branch.id,
        providerPrId: pullRequestId ? String(pullRequestId) : String(number),
        number,
        url: readString(pullRequest.html_url) ?? `https://github.com/${repository.fullName}/pull/${number}`,
        title: readString(pullRequest.title) ?? `PR #${number}`,
        status,
        isDraft,
        mergeableState: readString(pullRequest.mergeable_state),
        openedBy: readString(asRecord(pullRequest.user)?.login),
        openedAt: readDate(pullRequest.created_at),
        mergedBy: readString(asRecord(pullRequest.merged_by)?.login),
        mergedAt: readDate(pullRequest.merged_at)
      }
    });

    if (status === "merged") {
      await this.prisma.branch.update({
        where: {
          id: branch.id
        },
        data: {
          status: "merged",
          mergedAt: readDate(pullRequest.merged_at) ?? new Date()
        }
      });
      return;
    }

    if (status === "closed") {
      await this.prisma.branch.update({
        where: {
          id: branch.id
        },
        data: {
          status: "closed",
          closedAt: new Date()
        }
      });
    }
  }

  private async handleCheckEvent(eventName: "check_run" | "check_suite", payload: unknown) {
    const root = asRecord(payload);
    const repository = parseRepository(root?.repository);
    if (!repository) {
      return;
    }

    const syncedRepository = await this.prisma.repository.findUnique({
      where: {
        provider_providerRepoId: {
          provider: "github",
          providerRepoId: repository.providerRepoId
        }
      }
    });

    if (!syncedRepository) {
      return;
    }

    const checkPayload = asRecord(root?.[eventName]);
    if (!checkPayload) {
      return;
    }

    const checkName =
      readString(checkPayload.name) ??
      readString(asRecord(checkPayload.app)?.slug) ??
      (eventName === "check_run" ? "check-run" : "check-suite");

    const checkStatus = readString(checkPayload.status);
    const checkConclusion = readString(checkPayload.conclusion);
    const mappedStatus = mapGithubCheckStatus(checkStatus, checkConclusion);

    const pullRequestNumbers = extractArray(checkPayload.pull_requests)
      .map((item) => readNumber(asRecord(item)?.number))
      .filter((value): value is number => typeof value === "number");

    for (const pullRequestNumber of pullRequestNumbers) {
      const pullRequest = await this.prisma.pullRequest.findUnique({
        where: {
          repositoryId_number: {
            repositoryId: syncedRepository.id,
            number: pullRequestNumber
          }
        },
        include: {
          branch: true
        }
      });

      if (!pullRequest) {
        continue;
      }

      let run = await this.prisma.qualityGateRun.findFirst({
        where: {
          taskId: pullRequest.branch.taskId
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      if (!run) {
        run = await this.prisma.qualityGateRun.create({
          data: {
            orgId: pullRequest.branch.orgId,
            projectId: pullRequest.branch.projectId,
            taskId: pullRequest.branch.taskId,
            branchId: pullRequest.branchId,
            triggerSource: `github_${eventName}`,
            status: mappedStatus === "passed" || mappedStatus === "failed" || mappedStatus === "canceled"
              ? mappedStatus
              : "running",
            startedAt: new Date(),
            summary: {}
          }
        });
      }

      await this.prisma.qualityGateCheck.upsert({
        where: {
          runId_checkKey: {
            runId: run.id,
            checkKey: `github:${checkName}`
          }
        },
        update: {
          status: mappedStatus,
          details: toJson({
            eventName,
            status: checkStatus,
            conclusion: checkConclusion
          })
        },
        create: {
          runId: run.id,
          checkKey: `github:${checkName}`,
          status: mappedStatus,
          details: toJson({
            eventName,
            status: checkStatus,
            conclusion: checkConclusion
          })
        }
      });

      await this.recomputeQualityStatus(run.id);
    }
  }

  private async recomputeQualityStatus(runId: string) {
    const checks = await this.prisma.qualityGateCheck.findMany({
      where: {
        runId
      }
    });

    if (checks.length === 0) {
      return;
    }

    const hasFailed = checks.some((check) => check.status === "failed");
    const hasRunning = checks.some((check) => check.status === "running" || check.status === "queued");
    const allCanceled = checks.every((check) => check.status === "canceled");

    const nextStatus = hasFailed ? "failed" : hasRunning ? "running" : allCanceled ? "canceled" : "passed";

    await this.prisma.qualityGateRun.update({
      where: {
        id: runId
      },
      data: {
        status: nextStatus,
        endedAt: nextStatus === "running" ? null : new Date(),
        summary: toJson({
          totalChecks: checks.length,
          passed: checks.filter((check) => check.status === "passed").length,
          failed: checks.filter((check) => check.status === "failed").length,
          running: checks.filter((check) => check.status === "running" || check.status === "queued").length,
          canceled: checks.filter((check) => check.status === "canceled").length
        })
      }
    });
  }

  private async resolveRepositoryOrgId(
    providerRepoId: string,
    payloadRoot: JsonRecord | undefined
  ): Promise<string | undefined> {
    const existingRepository = await this.prisma.repository.findUnique({
      where: {
        provider_providerRepoId: {
          provider: "github",
          providerRepoId
        }
      },
      select: {
        orgId: true
      }
    });

    if (existingRepository) {
      return existingRepository.orgId;
    }

    const installationId = readNumber(asRecord(payloadRoot?.installation)?.id);
    if (!installationId) {
      return undefined;
    }

    const installation = await this.prisma.githubInstallation.findUnique({
      where: {
        githubInstallationId: BigInt(installationId)
      },
      select: {
        orgId: true
      }
    });

    return installation?.orgId;
  }

  private async resolveInstallationIdForRepository(input: {
    orgId: string;
    repositoryMetadata: unknown;
  }): Promise<number | undefined> {
    const metadataInstallation = readNumber(asRecord(input.repositoryMetadata)?.githubInstallationId);
    if (metadataInstallation) {
      return metadataInstallation;
    }

    const installation = await this.prisma.githubInstallation.findFirst({
      where: {
        orgId: input.orgId,
        uninstalledAt: null
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    return installation ? Number(installation.githubInstallationId) : undefined;
  }

  private async upsertRepositoryForOrg(input: {
    orgId: string;
    projectId?: string;
    repository: ParsedRepository | RepositoryInput;
  }) {
    const repo = input.repository;
    const fullName = "fullName" in repo ? repo.fullName : `${repo.owner}/${repo.name}`;
    const metadata = "metadata" in repo ? repo.metadata : {};

    const repository = await this.prisma.repository.upsert({
      where: {
        provider_providerRepoId: {
          provider: "github",
          providerRepoId: repo.providerRepoId
        }
      },
      update: {
        orgId: input.orgId,
        owner: repo.owner,
        name: repo.name,
        fullName,
        defaultBranch: repo.defaultBranch,
        isPrivate: repo.isPrivate,
        metadata: toJson(metadata)
      },
      create: {
        orgId: input.orgId,
        provider: "github",
        providerRepoId: repo.providerRepoId,
        owner: repo.owner,
        name: repo.name,
        fullName,
        defaultBranch: repo.defaultBranch,
        isPrivate: repo.isPrivate,
        metadata: toJson(metadata)
      }
    });

    if (input.projectId) {
      await this.prisma.projectRepository.upsert({
        where: {
          projectId_repositoryId: {
            projectId: input.projectId,
            repositoryId: repository.id
          }
        },
        update: {},
        create: {
          projectId: input.projectId,
          repositoryId: repository.id,
          isPrimary: false
        }
      });
    }

    return repository;
  }

  private async fetchInstallationRepositories(installationId: number): Promise<Array<ParsedRepository & { projectId?: string }>> {
    if (!this.env.githubAppId || !this.env.githubAppPrivateKey) {
      return [];
    }

    try {
      const app = new App({
        appId: this.env.githubAppId,
        privateKey: this.env.githubAppPrivateKey
      });
      const installationOctokit = await app.getInstallationOctokit(installationId);
      const repositories = await installationOctokit.paginate(
        installationOctokit.rest.apps.listReposAccessibleToInstallation,
        {
          per_page: 100
        }
      );

      return repositories
        .map((repository) => ({
          providerRepoId: String(repository.id),
          owner: repository.owner.login,
          name: repository.name,
          fullName: repository.full_name,
          defaultBranch: repository.default_branch ?? "main",
          isPrivate: Boolean(repository.private),
          metadata: {
            githubRepoNodeId: repository.node_id
          }
        }))
        .filter((repository) => repository.providerRepoId && repository.owner && repository.name);
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to fetch repositories from GitHub installation ${installationId}: ${error instanceof Error ? error.message : "unknown_error"}`
      );
    }
  }
}
