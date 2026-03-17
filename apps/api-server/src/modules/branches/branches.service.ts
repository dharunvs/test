import { randomUUID } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { buildTaskBranchName, isProtectedBranch } from "@branchline/git-utils";
import { App } from "octokit";

import { appendAuditLog } from "../../common/audit.js";
import { readEnv } from "../../common/env.js";
import { incrementGithubAutomation } from "../../common/metrics.js";
import { resolveProjectPolicy } from "../../common/policy.js";
import { PrismaService } from "../../common/prisma.service.js";

interface CreateBranchInput {
  projectId: string;
  taskId: string;
  ticketOrTask: string;
  taskSlug: string;
  currentBranch: string;
  actorUserId: string;
}

interface BranchPolicySweepInput {
  projectId: string;
  actorUserId: string;
}

interface EnsurePullRequestInput {
  branchId: string;
  actorUserId: string;
  title?: string;
  body?: string;
  draft?: boolean;
}

interface PromoteBranchInput {
  branchId: string;
  actorUserId: string;
  requireOpenPr: boolean;
  dryRun: boolean;
}

interface MergeBranchInput {
  branchId: string;
  actorUserId: string;
  strategy: "squash" | "merge" | "rebase";
  requireOpenPr: boolean;
  openDraftIfNeeded: boolean;
}

type QualityCheckKey =
  | "build"
  | "unit_tests"
  | "lint"
  | "dependency_audit"
  | "integration_tests";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
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

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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

@Injectable()
export class BranchesService {
  private readonly env = readEnv();

  constructor(private readonly prisma: PrismaService) {}

  async createBranch(input: CreateBranchInput) {
    const task = await this.prisma.task.findUnique({
      where: {
        id: input.taskId
      }
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    const policy = await resolveProjectPolicy(this.prisma, input.projectId);

    if (isProtectedBranch(input.currentBranch, policy.protectedBranches)) {
      return {
        blocked: true,
        reason: `AI edits are blocked on protected branch ${input.currentBranch}`,
        policy
      };
    }

    const branchName = buildTaskBranchName({
      ticketOrTask: input.ticketOrTask,
      taskSlug: input.taskSlug
    });

    const existingBranch = await this.prisma.branch.findFirst({
      where: {
        taskId: task.id,
        status: "active"
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (existingBranch) {
      const existingPr = await this.prisma.pullRequest.findFirst({
        where: {
          branchId: existingBranch.id,
          status: {
            in: ["open", "draft"]
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      return {
        blocked: false,
        branch: existingBranch,
        policy,
        pullRequest: existingPr
          ? {
              id: existingPr.id,
              number: existingPr.number,
              status: existingPr.status
            }
          : null
      };
    }

    const branch = await this.prisma.branch.create({
      data: {
        orgId: task.orgId,
        projectId: task.projectId,
        repositoryId: task.repositoryId,
        taskId: task.id,
        createdBy: input.actorUserId,
        name: branchName,
        baseBranch: policy.baseBranch,
        status: "active"
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: task.orgId,
      projectId: task.projectId,
      actorUserId: input.actorUserId,
      actorType: "user",
      eventType: "branch.created",
      entityType: "branch",
      entityId: branch.id,
      payload: {
        name: branch.name,
        taskId: task.id
      }
    });

    return {
      blocked: false,
      branch,
      policy,
      pullRequest: null
    };
  }

  async ensurePullRequest(input: EnsurePullRequestInput) {
    const branch = await this.prisma.branch.findUnique({
      where: {
        id: input.branchId
      },
      include: {
        repository: true,
        task: true
      }
    });

    if (!branch) {
      throw new NotFoundException("Branch not found");
    }

    const policy = await resolveProjectPolicy(this.prisma, branch.projectId);
    if (!policy.autoPr) {
      incrementGithubAutomation("ensure_pr", "auto_pr_disabled");
      return {
        created: false,
        providerMode: "github" as const,
        reason: "auto_pr_disabled",
        orgId: branch.orgId,
        projectId: branch.projectId,
        taskId: branch.taskId,
        repositoryId: branch.repositoryId,
        pullRequest: null
      };
    }

    const allowPlaceholderFallback = this.shouldAllowPlaceholderFallback();
    const failClosed = (reason: string) => {
      incrementGithubAutomation("ensure_pr", `fail_closed:${reason}`);
      return {
        created: false,
        providerMode: "github" as const,
        reason: `fail_closed:${reason}`,
        orgId: branch.orgId,
        projectId: branch.projectId,
        taskId: branch.taskId,
        repositoryId: branch.repositoryId,
        pullRequest: null
      };
    };

    const existingLocal = await this.prisma.pullRequest.findFirst({
      where: {
        branchId: branch.id,
        status: {
          in: ["open", "draft"]
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    const isPlaceholder = existingLocal?.providerPrId.startsWith("pending-") ?? false;
    if (existingLocal && !isPlaceholder) {
      return {
        created: false,
        providerMode: "github" as const,
        orgId: branch.orgId,
        projectId: branch.projectId,
        taskId: branch.taskId,
        repositoryId: branch.repositoryId,
        pullRequest: {
          id: existingLocal.id,
          number: existingLocal.number,
          status: existingLocal.status
        }
      };
    }

    const latestGuardrail = await this.prisma.guardrailEvaluation.findFirst({
      where: {
        taskId: branch.taskId,
        OR: [{ branchId: branch.id }, { branchId: null }]
      },
      orderBy: {
        evaluatedAt: "desc"
      }
    });

    if (latestGuardrail?.status === "fail") {
      return failClosed("guardrail_failed_pre_pr");
    }

    if (
      branch.repository.provider !== "github" ||
      !this.env.githubAppId ||
      !this.env.githubAppPrivateKey
    ) {
      const fallbackReason =
        branch.repository.provider !== "github"
          ? "repository_provider_not_supported_for_auto_pr"
          : "github_app_credentials_missing";

      if (!allowPlaceholderFallback) {
        return failClosed(fallbackReason);
      }

      const placeholder = await this.createPlaceholderPullRequest({
        branchId: branch.id,
        repositoryId: branch.repositoryId,
        orgId: branch.orgId,
        actorUserId: input.actorUserId,
        title: input.title ?? `AI Task: ${branch.task.title}`
      });
      incrementGithubAutomation("ensure_pr", "placeholder_created");

      return {
        created: !existingLocal,
        providerMode: "placeholder" as const,
        reason: fallbackReason,
        orgId: branch.orgId,
        projectId: branch.projectId,
        taskId: branch.taskId,
        repositoryId: branch.repositoryId,
        pullRequest: {
          id: placeholder.id,
          number: placeholder.number,
          status: placeholder.status
        }
      };
    }

    const installationId = await this.resolveGithubInstallationId({
      orgId: branch.orgId,
      repositoryMetadata: branch.repository.metadata
    });

    if (!installationId) {
      if (!allowPlaceholderFallback) {
        return failClosed("github_installation_not_resolved");
      }

      const placeholder = await this.createPlaceholderPullRequest({
        branchId: branch.id,
        repositoryId: branch.repositoryId,
        orgId: branch.orgId,
        actorUserId: input.actorUserId,
        title: input.title ?? `AI Task: ${branch.task.title}`
      });
      incrementGithubAutomation("ensure_pr", "placeholder_created");

      return {
        created: !existingLocal,
        providerMode: "placeholder" as const,
        reason: "github_installation_not_resolved",
        orgId: branch.orgId,
        projectId: branch.projectId,
        taskId: branch.taskId,
        repositoryId: branch.repositoryId,
        pullRequest: {
          id: placeholder.id,
          number: placeholder.number,
          status: placeholder.status
        }
      };
    }

    try {
      const app = new App({
        appId: this.env.githubAppId,
        privateKey: this.env.githubAppPrivateKey
      });
      const installationOctokit = await app.getInstallationOctokit(installationId);

      const remoteExisting = await installationOctokit.rest.pulls.list({
        owner: branch.repository.owner,
        repo: branch.repository.name,
        state: "open",
        head: `${branch.repository.owner}:${branch.name}`,
        base: branch.baseBranch,
        per_page: 1
      });

      const remotePullRequest =
        remoteExisting.data[0] ??
        (
          await installationOctokit.rest.pulls.create({
            owner: branch.repository.owner,
            repo: branch.repository.name,
            title: input.title ?? `AI Task: ${branch.task.title}`,
            head: branch.name,
            base: branch.baseBranch,
            body: input.body,
            draft: input.draft ?? true
          })
        ).data;

      const remote = asRecord(remotePullRequest);
      const remoteNumber = readNumber(remote?.number);
      if (!remote || !remoteNumber) {
        return {
          created: false,
          providerMode: "github" as const,
          reason: "github_pull_request_response_missing_number",
          orgId: branch.orgId,
          projectId: branch.projectId,
          taskId: branch.taskId,
          repositoryId: branch.repositoryId,
          pullRequest: null
        };
      }

      const persisted = await this.prisma.pullRequest.upsert({
        where: {
          repositoryId_number: {
            repositoryId: branch.repositoryId,
            number: remoteNumber
          }
        },
        update: {
          branchId: branch.id,
          providerPrId: String(remote.id ?? remoteNumber),
          url:
            readString(remote.html_url) ??
            `https://github.com/${branch.repository.fullName}/pull/${remoteNumber}`,
          title: readString(remote.title) ?? `PR #${remoteNumber}`,
          status: mapPullRequestStatus({
            state: readString(remote.state),
            draft: Boolean(remote.draft),
            mergedAt: readString(remote.merged_at)
          }),
          isDraft: Boolean(remote.draft),
          mergeableState: readString(remote.mergeable_state),
          openedBy: readString(asRecord(remote.user)?.login),
          openedAt: readString(remote.created_at) ? new Date(readString(remote.created_at) as string) : null,
          mergedBy: readString(asRecord(remote.merged_by)?.login),
          mergedAt: readString(remote.merged_at) ? new Date(readString(remote.merged_at) as string) : null
        },
        create: {
          orgId: branch.orgId,
          repositoryId: branch.repositoryId,
          branchId: branch.id,
          providerPrId: String(remote.id ?? remoteNumber),
          number: remoteNumber,
          url:
            readString(remote.html_url) ??
            `https://github.com/${branch.repository.fullName}/pull/${remoteNumber}`,
          title: readString(remote.title) ?? `PR #${remoteNumber}`,
          status: mapPullRequestStatus({
            state: readString(remote.state),
            draft: Boolean(remote.draft),
            mergedAt: readString(remote.merged_at)
          }),
          isDraft: Boolean(remote.draft),
          mergeableState: readString(remote.mergeable_state),
          openedBy: readString(asRecord(remote.user)?.login),
          openedAt: readString(remote.created_at) ? new Date(readString(remote.created_at) as string) : null,
          mergedBy: readString(asRecord(remote.merged_by)?.login),
          mergedAt: readString(remote.merged_at) ? new Date(readString(remote.merged_at) as string) : null
        }
      });

      if (existingLocal && existingLocal.id !== persisted.id) {
        await this.prisma.pullRequest.update({
          where: {
            id: existingLocal.id
          },
          data: {
            status: "closed",
            mergeableState: "superseded_by_github_pr"
          }
        });
      }

      await appendAuditLog({
        prisma: this.prisma,
        orgId: branch.orgId,
        projectId: branch.projectId,
        actorUserId: input.actorUserId,
        actorType: "user",
        eventType: "pull_request.ensured",
        entityType: "pull_request",
        entityId: persisted.id,
        payload: {
          branchId: branch.id,
          number: persisted.number,
          providerMode: "github"
        }
      });
      incrementGithubAutomation("ensure_pr", remoteExisting.data[0] ? "existing_pr" : "created_pr");

      return {
        created: !remoteExisting.data[0],
        providerMode: "github" as const,
        orgId: branch.orgId,
        projectId: branch.projectId,
        taskId: branch.taskId,
        repositoryId: branch.repositoryId,
        pullRequest: {
          id: persisted.id,
          number: persisted.number,
          status: persisted.status
        }
      };
    } catch (error) {
      incrementGithubAutomation("ensure_pr", "github_auto_pr_failed");
      return {
        created: false,
        providerMode: "github" as const,
        reason: `github_auto_pr_failed:${error instanceof Error ? error.message : "unknown_error"}`,
        orgId: branch.orgId,
        projectId: branch.projectId,
        taskId: branch.taskId,
        repositoryId: branch.repositoryId,
        pullRequest: null
      };
    }
  }

  async getBranchAutomationStatus(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: {
        id: branchId
      },
      include: {
        repository: true,
        task: true
      }
    });

    if (!branch) {
      throw new NotFoundException("Branch not found");
    }

    const [policy, latestGuardrail, latestQualityRun, latestPullRequest] = await Promise.all([
      resolveProjectPolicy(this.prisma, branch.projectId),
      this.prisma.guardrailEvaluation.findFirst({
        where: {
          taskId: branch.taskId,
          OR: [{ branchId: branch.id }, { branchId: null }]
        },
        orderBy: {
          evaluatedAt: "desc"
        }
      }),
      this.prisma.qualityGateRun.findFirst({
        where: {
          taskId: branch.taskId,
          OR: [{ branchId: branch.id }, { branchId: null }]
        },
        include: {
          checks: true
        },
        orderBy: {
          createdAt: "desc"
        }
      }),
      this.prisma.pullRequest.findFirst({
        where: {
          branchId: branch.id
        },
        orderBy: {
          createdAt: "desc"
        }
      })
    ]);

    const requiredQualityChecks = this.normalizeRequiredChecks(policy.requiredQualityChecks);
    const checkStatus = new Map(
      (latestQualityRun?.checks ?? []).map((check) => [check.checkKey as QualityCheckKey, check.status])
    );
    const missingRequiredChecks =
      latestQualityRun?.status === "passed"
        ? requiredQualityChecks.filter((checkKey) => checkStatus.get(checkKey) !== "passed")
        : requiredQualityChecks;

    const blockingReasons: string[] = [];
    if (policy.enforceGuardrailRecheckOnPromote && latestGuardrail?.status === "fail") {
      blockingReasons.push("guardrail_failed");
    }
    if (!latestQualityRun) {
      blockingReasons.push("quality_run_missing");
    } else if (latestQualityRun.status !== "passed") {
      blockingReasons.push(`quality_status_${latestQualityRun.status}`);
    } else if (missingRequiredChecks.length > 0) {
      blockingReasons.push("quality_required_checks_failed");
    }
    if (!latestPullRequest || !["open", "draft"].includes(latestPullRequest.status)) {
      blockingReasons.push("open_pull_request_required");
    }

    return {
      orgId: branch.orgId,
      projectId: branch.projectId,
      taskId: branch.taskId,
      branchId: branch.id,
      branchName: branch.name,
      repositoryId: branch.repositoryId,
      repositoryProvider: branch.repository.provider,
      repositoryFullName: branch.repository.fullName,
      policy,
      pullRequest: latestPullRequest
        ? {
            id: latestPullRequest.id,
            number: latestPullRequest.number,
            status: latestPullRequest.status,
            isDraft: latestPullRequest.isDraft,
            mergeableState: latestPullRequest.mergeableState
          }
        : null,
      guardrail: latestGuardrail
        ? {
            id: latestGuardrail.id,
            status: latestGuardrail.status,
            evaluatedAt: latestGuardrail.evaluatedAt
          }
        : null,
      quality: latestQualityRun
        ? {
            id: latestQualityRun.id,
            status: latestQualityRun.status,
            startedAt: latestQualityRun.startedAt,
            endedAt: latestQualityRun.endedAt,
            checks: latestQualityRun.checks.map((check) => ({
              key: check.checkKey,
              status: check.status
            }))
          }
        : null,
      requiredQualityChecks,
      missingRequiredChecks,
      blockingReasons
    };
  }

  async markStaleBranches(input: BranchPolicySweepInput) {
    const policy = await resolveProjectPolicy(this.prisma, input.projectId);
    const threshold = new Date(Date.now() - policy.staleThresholdMinutes * 60 * 1000);

    const candidates = await this.prisma.branch.findMany({
      where: {
        projectId: input.projectId,
        status: "active",
        updatedAt: {
          lt: threshold
        }
      },
      select: {
        id: true,
        orgId: true,
        projectId: true,
        repositoryId: true,
        taskId: true,
        name: true
      }
    });

    if (candidates.length === 0) {
      return {
        scanned: 0,
        markedStale: 0
      };
    }

    await this.prisma.branch.updateMany({
      where: {
        id: {
          in: candidates.map((branch) => branch.id)
        }
      },
      data: {
        status: "stale",
        staleReason: "policy_threshold_exceeded"
      }
    });

    const first = candidates[0];
    if (first) {
      await appendAuditLog({
        prisma: this.prisma,
        orgId: first.orgId,
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        actorType: "user",
        eventType: "branch.stale_scan_completed",
        entityType: "project",
        entityId: input.projectId,
        payload: {
          staleThresholdMinutes: policy.staleThresholdMinutes,
          markedStale: candidates.length
        }
      });
    }

    return {
      scanned: candidates.length,
      markedStale: candidates.length
    };
  }

  async promoteBranch(input: PromoteBranchInput) {
    const branch = await this.prisma.branch.findUnique({
      where: {
        id: input.branchId
      },
      include: {
        task: true
      }
    });

    if (!branch) {
      throw new NotFoundException("Branch not found");
    }

    const policy = await resolveProjectPolicy(this.prisma, branch.projectId);
    const requiredQualityChecks = this.normalizeRequiredChecks(policy.requiredQualityChecks);

    const latestGuardrail = await this.prisma.guardrailEvaluation.findFirst({
      where: {
        taskId: branch.taskId,
        OR: [{ branchId: branch.id }, { branchId: null }]
      },
      orderBy: {
        evaluatedAt: "desc"
      }
    });

    if (policy.enforceGuardrailRecheckOnPromote && latestGuardrail?.status === "fail") {
      return {
        promoted: false,
        reason: "guardrail_failed",
        orgId: branch.orgId,
        projectId: branch.projectId,
        taskId: branch.taskId,
        branchId: branch.id,
        qualityRunId: undefined,
        guardrailStatus: latestGuardrail.status,
        requiredQualityChecks,
        missingRequiredChecks: [],
        pullRequest: null
      };
    }

    const latestRun = await this.prisma.qualityGateRun.findFirst({
      where: {
        taskId: branch.taskId,
        OR: [{ branchId: branch.id }, { branchId: null }]
      },
      include: {
        checks: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (!latestRun) {
      return {
        promoted: false,
        reason: "quality_run_missing",
        orgId: branch.orgId,
        projectId: branch.projectId,
        taskId: branch.taskId,
        branchId: branch.id,
        qualityRunId: undefined,
        guardrailStatus: latestGuardrail?.status ?? null,
        requiredQualityChecks,
        missingRequiredChecks: requiredQualityChecks,
        pullRequest: null
      };
    }

    if (latestRun.status !== "passed") {
      return {
        promoted: false,
        reason: `quality_status_${latestRun.status}`,
        orgId: branch.orgId,
        projectId: branch.projectId,
        taskId: branch.taskId,
        branchId: branch.id,
        qualityRunId: latestRun.id,
        guardrailStatus: latestGuardrail?.status ?? null,
        requiredQualityChecks,
        missingRequiredChecks: requiredQualityChecks,
        pullRequest: null
      };
    }

    const checkStatus = new Map(
      latestRun.checks.map((check) => [check.checkKey as QualityCheckKey, check.status])
    );
    const missingRequiredChecks = requiredQualityChecks.filter(
      (checkKey) => checkStatus.get(checkKey) !== "passed"
    );

    if (missingRequiredChecks.length > 0) {
      return {
        promoted: false,
        reason: "quality_required_checks_failed",
        orgId: branch.orgId,
        projectId: branch.projectId,
        taskId: branch.taskId,
        branchId: branch.id,
        qualityRunId: latestRun.id,
        guardrailStatus: latestGuardrail?.status ?? null,
        requiredQualityChecks,
        missingRequiredChecks,
        pullRequest: null
      };
    }

    const openPullRequest = await this.prisma.pullRequest.findFirst({
      where: {
        branchId: branch.id,
        status: {
          in: ["open", "draft"]
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (input.requireOpenPr && !openPullRequest) {
      return {
        promoted: false,
        reason: "open_pull_request_required",
        orgId: branch.orgId,
        projectId: branch.projectId,
        taskId: branch.taskId,
        branchId: branch.id,
        qualityRunId: latestRun.id,
        guardrailStatus: latestGuardrail?.status ?? null,
        requiredQualityChecks,
        missingRequiredChecks: [],
        pullRequest: null
      };
    }

    if (!input.dryRun) {
      await appendAuditLog({
        prisma: this.prisma,
        orgId: branch.orgId,
        projectId: branch.projectId,
        actorUserId: input.actorUserId,
        actorType: "user",
        eventType: "branch.promoted",
        entityType: "branch",
        entityId: branch.id,
        payload: {
          taskId: branch.taskId,
          qualityRunId: latestRun.id,
          guardrailStatus: latestGuardrail?.status ?? null,
          requiredQualityChecks,
          pullRequestId: openPullRequest?.id ?? null
        }
      });
    }

    return {
      promoted: true,
      reason: input.dryRun ? "dry_run" : "promoted",
      orgId: branch.orgId,
      projectId: branch.projectId,
      taskId: branch.taskId,
      branchId: branch.id,
      qualityRunId: latestRun.id,
      guardrailStatus: latestGuardrail?.status ?? null,
      requiredQualityChecks,
      missingRequiredChecks: [],
      pullRequest: openPullRequest
        ? {
            id: openPullRequest.id,
            number: openPullRequest.number,
            status: openPullRequest.status
          }
        : null
    };
  }

  async mergeBranch(input: MergeBranchInput) {
    const branch = await this.prisma.branch.findUnique({
      where: {
        id: input.branchId
      },
      include: {
        repository: true,
        task: true
      }
    });

    if (!branch) {
      throw new NotFoundException("Branch not found");
    }

    const gate = await this.promoteBranch({
      branchId: input.branchId,
      actorUserId: input.actorUserId,
      requireOpenPr: input.requireOpenPr,
      dryRun: true
    });

    if (!gate.promoted) {
      incrementGithubAutomation("merge", `gate_failed:${gate.reason}`);
      return {
        merged: false,
        reason: `merge_gate_failed:${gate.reason}`,
        orgId: gate.orgId,
        projectId: gate.projectId,
        taskId: gate.taskId,
        branchId: gate.branchId,
        pullRequest: gate.pullRequest,
        strategy: input.strategy
      };
    }

    if (branch.repository.provider !== "github") {
      incrementGithubAutomation("merge", "fail_closed:repository_provider_not_supported_for_merge");
      return {
        merged: false,
        reason: "fail_closed:repository_provider_not_supported_for_merge",
        orgId: gate.orgId,
        projectId: gate.projectId,
        taskId: gate.taskId,
        branchId: gate.branchId,
        pullRequest: gate.pullRequest,
        strategy: input.strategy
      };
    }

    if (!this.env.githubAppId || !this.env.githubAppPrivateKey) {
      incrementGithubAutomation("merge", "fail_closed:github_app_credentials_missing");
      return {
        merged: false,
        reason: "fail_closed:github_app_credentials_missing",
        orgId: gate.orgId,
        projectId: gate.projectId,
        taskId: gate.taskId,
        branchId: gate.branchId,
        pullRequest: gate.pullRequest,
        strategy: input.strategy
      };
    }

    const installationId = await this.resolveGithubInstallationId({
      orgId: branch.orgId,
      repositoryMetadata: branch.repository.metadata
    });

    if (!installationId) {
      incrementGithubAutomation("merge", "fail_closed:github_installation_not_resolved");
      return {
        merged: false,
        reason: "fail_closed:github_installation_not_resolved",
        orgId: gate.orgId,
        projectId: gate.projectId,
        taskId: gate.taskId,
        branchId: gate.branchId,
        pullRequest: gate.pullRequest,
        strategy: input.strategy
      };
    }

    const openPullRequest = await this.prisma.pullRequest.findFirst({
      where: {
        branchId: branch.id,
        status: {
          in: ["open", "draft"]
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (!openPullRequest) {
      incrementGithubAutomation("merge", "fail_closed:open_pull_request_required");
      return {
        merged: false,
        reason: "fail_closed:open_pull_request_required",
        orgId: gate.orgId,
        projectId: gate.projectId,
        taskId: gate.taskId,
        branchId: gate.branchId,
        pullRequest: null,
        strategy: input.strategy
      };
    }

    try {
      const app = new App({
        appId: this.env.githubAppId,
        privateKey: this.env.githubAppPrivateKey
      });
      const installationOctokit = await app.getInstallationOctokit(installationId);

      if (openPullRequest.isDraft && !input.openDraftIfNeeded) {
        incrementGithubAutomation("merge", "fail_closed:draft_pull_request");
        return {
          merged: false,
          reason: "fail_closed:draft_pull_request",
          orgId: gate.orgId,
          projectId: gate.projectId,
          taskId: gate.taskId,
          branchId: gate.branchId,
          pullRequest: {
            id: openPullRequest.id,
            number: openPullRequest.number,
            status: openPullRequest.status
          },
          strategy: input.strategy
        };
      }

      if (openPullRequest.isDraft && input.openDraftIfNeeded) {
        await installationOctokit.request(
          "POST /repos/{owner}/{repo}/pulls/{pull_number}/ready_for_review",
          {
            owner: branch.repository.owner,
            repo: branch.repository.name,
            pull_number: openPullRequest.number
          }
        );
      }

      const mergeResponse = await installationOctokit.rest.pulls.merge({
        owner: branch.repository.owner,
        repo: branch.repository.name,
        pull_number: openPullRequest.number,
        merge_method: input.strategy
      });

      const mergePayload = asRecord(mergeResponse.data);
      const merged = Boolean(mergePayload?.merged);
      if (!merged) {
        incrementGithubAutomation("merge", "merge_rejected");
        return {
          merged: false,
          reason: `github_merge_rejected:${readString(mergePayload?.message) ?? "unknown_reason"}`,
          orgId: gate.orgId,
          projectId: gate.projectId,
          taskId: gate.taskId,
          branchId: gate.branchId,
          pullRequest: {
            id: openPullRequest.id,
            number: openPullRequest.number,
            status: openPullRequest.status
          },
          strategy: input.strategy
        };
      }

      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.pullRequest.update({
          where: {
            id: openPullRequest.id
          },
          data: {
            status: "merged",
            isDraft: false,
            mergedAt: now,
            mergedBy: input.actorUserId,
            mergeableState: "merged"
          }
        }),
        this.prisma.branch.update({
          where: {
            id: branch.id
          },
          data: {
            status: "merged",
            mergedAt: now
          }
        })
      ]);

      await appendAuditLog({
        prisma: this.prisma,
        orgId: branch.orgId,
        projectId: branch.projectId,
        actorUserId: input.actorUserId,
        actorType: "user",
        eventType: "branch.merged",
        entityType: "branch",
        entityId: branch.id,
        payload: {
          taskId: branch.taskId,
          pullRequestId: openPullRequest.id,
          pullRequestNumber: openPullRequest.number,
          strategy: input.strategy
        }
      });
      incrementGithubAutomation("merge", "merged");

      return {
        merged: true,
        reason: "merged",
        orgId: gate.orgId,
        projectId: gate.projectId,
        taskId: gate.taskId,
        branchId: gate.branchId,
        pullRequest: {
          id: openPullRequest.id,
          number: openPullRequest.number,
          status: "merged"
        },
        strategy: input.strategy,
        mergeCommitSha: readString(mergePayload?.sha) ?? null
      };
    } catch (error) {
      incrementGithubAutomation("merge", "github_merge_failed");
      return {
        merged: false,
        reason: `github_merge_failed:${error instanceof Error ? error.message : "unknown_error"}`,
        orgId: gate.orgId,
        projectId: gate.projectId,
        taskId: gate.taskId,
        branchId: gate.branchId,
        pullRequest: {
          id: openPullRequest.id,
          number: openPullRequest.number,
          status: openPullRequest.status
        },
        strategy: input.strategy
      };
    }
  }

  async cleanupMergedBranches(input: BranchPolicySweepInput) {
    const policy = await resolveProjectPolicy(this.prisma, input.projectId);
    const threshold = new Date(Date.now() - policy.cleanupAfterMergeHours * 60 * 60 * 1000);

    const candidates = await this.prisma.branch.findMany({
      where: {
        projectId: input.projectId,
        status: "merged",
        mergedAt: {
          lt: threshold
        }
      },
      select: {
        id: true,
        orgId: true,
        name: true
      }
    });

    if (candidates.length === 0) {
      return {
        scanned: 0,
        cleaned: 0
      };
    }

    await this.prisma.branch.updateMany({
      where: {
        id: {
          in: candidates.map((branch) => branch.id)
        }
      },
      data: {
        status: "closed",
        closedAt: new Date(),
        staleReason: "cleanup_after_merge"
      }
    });

    const first = candidates[0];
    if (first) {
      await appendAuditLog({
        prisma: this.prisma,
        orgId: first.orgId,
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        actorType: "user",
        eventType: "branch.cleanup_completed",
        entityType: "project",
        entityId: input.projectId,
        payload: {
          cleanupAfterMergeHours: policy.cleanupAfterMergeHours,
          cleaned: candidates.length
        }
      });
    }

    return {
      scanned: candidates.length,
      cleaned: candidates.length
    };
  }

  private async resolveGithubInstallationId(input: {
    orgId: string;
    repositoryMetadata: unknown;
  }): Promise<number | undefined> {
    const metadata = asRecord(input.repositoryMetadata);
    const metadataInstallation = readNumber(metadata?.githubInstallationId);
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

    if (!installation) {
      return undefined;
    }

    return Number(installation.githubInstallationId);
  }

  private async createPlaceholderPullRequest(input: {
    branchId: string;
    repositoryId: string;
    orgId: string;
    actorUserId: string;
    title: string;
  }) {
    const existingPlaceholder = await this.prisma.pullRequest.findFirst({
      where: {
        branchId: input.branchId,
        status: {
          in: ["open", "draft"]
        },
        providerPrId: {
          startsWith: "pending-"
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (existingPlaceholder) {
      return existingPlaceholder;
    }

    const sequence = await this.prisma.pullRequest.count({
      where: {
        repositoryId: input.repositoryId,
        providerPrId: {
          startsWith: "pending-"
        }
      }
    });

    return this.prisma.pullRequest.create({
      data: {
        orgId: input.orgId,
        repositoryId: input.repositoryId,
        branchId: input.branchId,
        providerPrId: `pending-${randomUUID()}`,
        number: 900000 + sequence + 1,
        url: `https://github.com/pending/${input.branchId}`,
        title: input.title,
        status: "draft",
        isDraft: true,
        openedBy: input.actorUserId,
        openedAt: new Date()
      }
    });
  }

  private normalizeRequiredChecks(
    checks: ReadonlyArray<string> | undefined
  ): QualityCheckKey[] {
    const allowed: QualityCheckKey[] = [
      "build",
      "unit_tests",
      "lint",
      "dependency_audit",
      "integration_tests"
    ];

    if (!checks || checks.length === 0) {
      return ["build", "unit_tests", "lint", "dependency_audit"];
    }

    const deduped = checks
      .filter((check): check is QualityCheckKey => allowed.includes(check as QualityCheckKey))
      .filter((check, index, array) => array.indexOf(check) === index);

    return deduped.length > 0 ? deduped : ["build", "unit_tests", "lint", "dependency_audit"];
  }

  private shouldAllowPlaceholderFallback() {
    return this.env.nodeEnv === "development" && this.env.githubAllowPlaceholderPr;
  }
}
