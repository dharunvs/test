import { z } from "zod";

const deviceStartResponseSchema = z.object({
  deviceCode: z.string().uuid(),
  userCode: z.string(),
  verificationUri: z.string(),
  verificationUriComplete: z.string(),
  verificationRequired: z.boolean().optional().default(true),
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

const intentCaptureResponseSchema = z.object({
  accepted: z.boolean(),
  taskId: z.string(),
  eventId: z.string(),
  eventSeq: z.number(),
  redactionLevel: z.string().optional()
});

const intentTimelineSchema = z.object({
  taskId: z.string(),
  events: z
    .array(
      z.object({
        eventId: z.string(),
        eventSeq: z.number(),
        timestamp: z.string(),
        prompt: z.string(),
        summary: z.string(),
        files: z.array(z.string()),
        commitId: z.string(),
        redactionLevel: z.string()
      })
    )
    .default([])
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

  async exchangeGithubToken(payload: { accessToken: string }) {
    const response = await this.request("/auth/github/token", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return tokenBundleSchema.parse(response);
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

  async bindRepository(payload: {
    projectId: string;
    provider: "github" | "gitlab";
    providerRepoId?: string;
    owner: string;
    name: string;
    defaultBranch?: string;
    isPrivate?: boolean;
  }) {
    const response = await this.request("/repositories/bind", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return z
      .object({
        id: z.string(),
        fullName: z.string(),
        projectId: z.string(),
        createdAt: z.string()
      })
      .parse(response);
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

  async captureIntent(payload: {
    taskId: string;
    prompt: string;
    summary: string;
    files: string[];
    commitId: string;
  }) {
    const response = await this.request("/intent", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return intentCaptureResponseSchema.parse(response);
  }

  async fetchIntentTimeline(taskId: string, limit = 5) {
    const search = new URLSearchParams({
      taskId,
      limit: String(limit)
    });

    const response = await this.request(`/intent?${search.toString()}`, {
      method: "GET"
    });

    return intentTimelineSchema.parse(response);
  }
}
