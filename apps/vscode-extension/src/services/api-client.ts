import { z } from "zod";

const deviceStartResponseSchema = z.object({
  deviceCode: z.string().uuid(),
  userCode: z.string(),
  verificationUri: z.string(),
  verificationUriComplete: z.string(),
  expiresIn: z.number(),
  interval: z.number()
});

const tokenBundleSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number(),
  refreshExpiresAt: z.string().optional()
});

const deviceTokenResponseSchema = z.union([
  z.object({
    status: z.literal("authorization_pending")
  }),
  z.object({
    status: z.literal("approved")
  }).merge(tokenBundleSchema)
]);

const policySchema = z.object({
  baseBranch: z.string(),
  protectedBranches: z.array(z.string()),
  autoPush: z.boolean(),
  autoPr: z.boolean(),
  staleThresholdMinutes: z.number(),
  cleanupAfterMergeHours: z.number()
});

const branchCreateResponseSchema = z.object({
  blocked: z.boolean(),
  reason: z.string().optional(),
  policy: policySchema,
  branch: z
    .object({
      id: z.string(),
      name: z.string(),
      baseBranch: z.string()
    })
    .optional(),
  pullRequest: z
    .object({
      id: z.string(),
      number: z.number(),
      status: z.string()
    })
    .nullable()
    .optional()
});

const ensurePrResponseSchema = z.object({
  created: z.boolean(),
  providerMode: z.enum(["github", "placeholder"]),
  reason: z.string().optional(),
  pullRequest: z
    .object({
      id: z.string(),
      number: z.number(),
      status: z.string()
    })
    .nullable(),
  orgId: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  repositoryId: z.string()
});

const branchPromoteResponseSchema = z.object({
  promoted: z.boolean(),
  reason: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  branchId: z.string(),
  qualityRunId: z.string().optional(),
  guardrailStatus: z.string().nullable(),
  requiredQualityChecks: z.array(
    z.enum(["build", "unit_tests", "lint", "dependency_audit", "integration_tests"])
  ),
  missingRequiredChecks: z.array(
    z.enum(["build", "unit_tests", "lint", "dependency_audit", "integration_tests"])
  ),
  pullRequest: z
    .object({
      id: z.string(),
      number: z.number(),
      status: z.string()
    })
    .nullable()
});

const branchMergeResponseSchema = z.object({
  merged: z.boolean(),
  reason: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  branchId: z.string(),
  strategy: z.enum(["squash", "merge", "rebase"]),
  mergeCommitSha: z.string().nullable().optional(),
  pullRequest: z
    .object({
      id: z.string(),
      number: z.number(),
      status: z.string()
    })
    .nullable()
});

const workspaceValidateSchema = z.object({
  valid: z.boolean()
});

const workspaceBindSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  repositoryId: z.string(),
  workspaceHash: z.string(),
  lastBoundAt: z.string()
});

const guardrailEvalResponseSchema = z.object({
  status: z.enum(["pass", "warn", "fail"]),
  stage: z.enum(["pre_apply", "pre_pr", "promote"]),
  blocking: z.boolean(),
  reasonCodes: z.array(z.string()).default([]),
  violations: z.array(
    z.object({
      ruleKey: z.string(),
      severity: z.enum(["warn", "fail"]),
      message: z.string()
    })
  ),
  evaluationId: z.string(),
  policySetId: z.string(),
  policyVersion: z.number(),
  evaluatedBy: z.string()
});

const orgSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.string()
});

const projectSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  key: z.string(),
  defaultBaseBranch: z.string().optional()
});

const repositorySchema = z.object({
  id: z.string(),
  provider: z.string(),
  fullName: z.string(),
  defaultBranch: z.string(),
  isPrivate: z.boolean()
});

const handoffSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  summary: z.string(),
  createdAt: z.string()
});

const taskWithHandoffsSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  handoffPackets: z.array(handoffSchema).default([])
});

const replaySchema = z.object({
  taskId: z.string(),
  snapshotVersion: z.number(),
  generatedAt: z.string(),
  steps: z.array(z.string())
});

const timelineEntrySchema = z.object({
  timestamp: z.string(),
  type: z.string(),
  category: z.string(),
  id: z.string()
});

const taskTimelineSchema = z.object({
  taskId: z.string(),
  counts: z
    .object({
      intentEvents: z.number(),
      decisions: z.number(),
      activityEvents: z.number(),
      qualityRuns: z.number(),
      handoffs: z.number(),
      conflicts: z.number(),
      branches: z.number()
    })
    .optional(),
  timeline: z.array(timelineEntrySchema).default([])
});

const ownershipClaimSchema = z.object({
  id: z.string(),
  scopeType: z.string(),
  scopeValue: z.string(),
  expiresAt: z.string()
});

const presenceSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  userId: z.string(),
  state: z.string(),
  activeFilePath: z.string().nullable().optional(),
  lastSeenAt: z.string()
});

const conflictSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  taskId: z.string().nullable().optional(),
  otherTaskId: z.string().nullable().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  score: z.union([z.number(), z.string()]).transform((value) => Number(value)),
  filePaths: z.array(z.string()),
  symbolNames: z.array(z.string()),
  reasonCodes: z.array(z.string()).optional(),
  suggestedAction: z.string().optional(),
  resolutionStatus: z.string(),
  createdAt: z.string()
});

const taskHandoffSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  summary: z.string(),
  createdAt: z.string(),
  acks: z
    .array(
      z.object({
        id: z.string(),
        ackBy: z.string(),
        ackAt: z.string()
      })
    )
    .default([])
});

const branchAutomationStatusSchema = z.object({
  orgId: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  branchId: z.string(),
  branchName: z.string(),
  repositoryId: z.string(),
  repositoryProvider: z.string(),
  policy: policySchema,
  pullRequest: z
    .object({
      id: z.string(),
      number: z.number(),
      status: z.string(),
      isDraft: z.boolean(),
      mergeableState: z.string().nullable().optional()
    })
    .nullable(),
  guardrail: z
    .object({
      id: z.string(),
      status: z.string(),
      evaluatedAt: z.string()
    })
    .nullable(),
  quality: z
    .object({
      id: z.string(),
      status: z.string(),
      checks: z.array(
        z.object({
          key: z.string(),
          status: z.string()
        })
      )
    })
    .nullable(),
  requiredQualityChecks: z.array(z.string()),
  missingRequiredChecks: z.array(z.string()),
  blockingReasons: z.array(z.string())
});

export class ApiClient {
  constructor(private readonly baseUrl: string, private readonly token?: string) {}

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Branchline API request failed: ${response.status} ${response.statusText} ${text}`);
    }

    return response.json();
  }

  async startDeviceAuth(payload?: { email?: string; role?: "owner" | "admin" | "member" | "viewer" }) {
    const response = await this.request("/auth/device/start", {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    });

    return deviceStartResponseSchema.parse(response);
  }

  async exchangeDeviceCode(deviceCode: string) {
    const response = await this.request("/auth/device/token", {
      method: "POST",
      body: JSON.stringify({ deviceCode })
    });

    return deviceTokenResponseSchema.parse(response);
  }

  async refreshAuth(payload: { refreshToken: string }) {
    const response = await this.request("/auth/refresh", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return tokenBundleSchema.parse(response);
  }

  async logoutAuth(payload: { refreshToken: string }) {
    const response = await this.request("/auth/logout", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return z.object({ ok: z.boolean() }).parse(response);
  }

  async listOrganizations() {
    const response = await this.request("/orgs", {
      method: "GET"
    });

    return z.array(orgSchema).parse(response);
  }

  async listProjects(orgId: string) {
    const response = await this.request(`/projects/${orgId}`, {
      method: "GET"
    });

    return z.array(projectSchema).parse(response);
  }

  async listRepositories(projectId: string) {
    const response = await this.request(`/repositories?projectId=${projectId}`, {
      method: "GET"
    });

    return z.array(repositorySchema).parse(response);
  }

  async validateWorkspaceMapping(payload: { projectId: string; repositoryId: string; workspaceHash?: string }) {
    const response = await this.request("/workspaces/validate", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return workspaceValidateSchema.parse(response);
  }

  async bindWorkspace(payload: {
    orgId: string;
    projectId: string;
    repositoryId: string;
    workspaceHash: string;
    extensionVersion: string;
    vscodeVersion?: string;
    os?: string;
  }) {
    const response = await this.request("/workspaces/bind", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return workspaceBindSchema.parse(response);
  }

  async startTask(payload: {
    orgId: string;
    projectId: string;
    repositoryId: string;
    title: string;
  }) {
    return this.request("/tasks/start", {
      method: "POST",
      body: JSON.stringify(payload)
    }) as Promise<{ id: string; title: string }>;
  }

  async createBranch(payload: {
    projectId: string;
    taskId: string;
    ticketOrTask: string;
    taskSlug: string;
    currentBranch: string;
  }) {
    const response = await this.request("/branches/create", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return branchCreateResponseSchema.parse(response);
  }

  async ensureBranchPullRequest(
    branchId: string,
    payload?: {
      title?: string;
      body?: string;
      draft?: boolean;
    }
  ) {
    const response = await this.request(`/branches/${branchId}/ensure-pr`, {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    });

    return ensurePrResponseSchema.parse(response);
  }

  async promoteBranch(
    branchId: string,
    payload?: {
      requireOpenPr?: boolean;
      dryRun?: boolean;
    }
  ) {
    const response = await this.request(`/branches/${branchId}/promote`, {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    });

    return branchPromoteResponseSchema.parse(response);
  }

  async mergeBranch(
    branchId: string,
    payload?: {
      strategy?: "squash" | "merge" | "rebase";
      requireOpenPr?: boolean;
      openDraftIfNeeded?: boolean;
    }
  ) {
    const response = await this.request(`/branches/${branchId}/merge`, {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    });

    return branchMergeResponseSchema.parse(response);
  }

  async sendIntentEvent(payload: Record<string, unknown>) {
    return this.request("/intent/events", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async evaluateGuardrails(payload: {
    projectId: string;
    taskId: string;
    branchId?: string;
    stage?: "pre_apply" | "pre_pr" | "promote";
    changedPaths: string[];
  }) {
    const response = await this.request("/guardrails/evaluate", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return guardrailEvalResponseSchema.parse(response);
  }

  async ingestCommitMetadata(payload: {
    orgId: string;
    projectId: string;
    taskId: string;
    branchId?: string;
    runId: string;
    intentId: string;
    commitSha: string;
    provider?: string;
    model?: string;
  }) {
    return this.request("/intent/commit-metadata", {
      method: "POST",
      body: JSON.stringify(payload)
    }) as Promise<{
      ok: boolean;
      runId: string;
      taskId: string;
      branchId?: string;
      commitSha: string;
    }>;
  }

  async updatePresence(payload: {
    orgId: string;
    projectId: string;
    taskId?: string;
    branchId?: string;
    repositoryId?: string;
    state: string;
    activeFilePath?: string;
    activeSymbol?: string;
  }) {
    return this.request("/activity/presence", {
      method: "POST",
      body: JSON.stringify(payload)
    }) as Promise<{
      ok: boolean;
      presence: {
        id: string;
      };
    }>;
  }

  async createTaskHandoff(taskId: string) {
    const response = await this.request(`/tasks/${taskId}/handoff`, {
      method: "POST",
      body: JSON.stringify({})
    });

    return handoffSchema.parse(response);
  }

  async getTask(taskId: string) {
    const response = await this.request(`/tasks/${taskId}`, {
      method: "GET"
    });

    return taskWithHandoffsSchema.parse(response);
  }

  async acknowledgeHandoff(handoffId: string, notes?: string) {
    const response = await this.request(`/handoffs/${handoffId}/ack`, {
      method: "POST",
      body: JSON.stringify({
        notes
      })
    });

    return z
      .object({
        id: z.string(),
        handoffPacketId: z.string(),
        ackBy: z.string(),
        ackAt: z.string(),
        notes: z.string().nullable().optional()
      })
      .parse(response);
  }

  async fetchReplay(taskId: string) {
    const response = await this.request(`/replay/${taskId}`, {
      method: "GET"
    });

    return replaySchema.parse(response);
  }

  async fetchTaskTimeline(taskId: string) {
    const search = new URLSearchParams({
      taskId,
      includeRelated: "true",
      limit: "200"
    });

    const response = await this.request(`/intent/timeline?${search.toString()}`, {
      method: "GET"
    });

    return taskTimelineSchema.parse(response);
  }

  async claimOwnership(payload: {
    orgId: string;
    projectId: string;
    taskId: string;
    scopeType?: string;
    scopeValue: string;
    ttlMinutes?: number;
  }) {
    const response = await this.request("/conflicts/claims", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return ownershipClaimSchema.parse(response);
  }

  async fetchPresence(projectId: string) {
    const search = new URLSearchParams({
      projectId
    });
    const response = await this.request(`/activity/presence?${search.toString()}`, {
      method: "GET"
    });

    return z.array(presenceSchema).parse(response);
  }

  async fetchTaskConflicts(taskId: string) {
    const response = await this.request(`/tasks/${taskId}/conflicts`, {
      method: "GET"
    });

    return z.array(conflictSummarySchema).parse(response);
  }

  async fetchTaskHandoffs(taskId: string) {
    const response = await this.request(`/tasks/${taskId}/handoffs`, {
      method: "GET"
    });

    return z.array(taskHandoffSchema).parse(response);
  }

  async fetchBranchAutomationStatus(branchId: string) {
    const response = await this.request(`/branches/${branchId}/automation-status`, {
      method: "GET"
    });

    return branchAutomationStatusSchema.parse(response);
  }
}
