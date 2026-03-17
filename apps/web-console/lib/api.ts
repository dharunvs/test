import "server-only";

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { z } from "zod";

import { isClerkConfigured, missingClerkConfigMessage } from "./clerk";

const baseUrl = process.env.BRANCHLINE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/v1";
const apiTokenTemplate = process.env.CLERK_API_TOKEN_TEMPLATE;
const e2eBearerToken = process.env.BRANCHLINE_E2E_BEARER_TOKEN?.trim();

const ACTIVE_ORG_COOKIE = "branchline.active_org_id";
const ACTIVE_PROJECT_COOKIE = "branchline.active_project_id";

const organizationSchema = z.object({
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

const organizationCreateSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string().optional()
});

const projectCreateSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  key: z.string(),
  defaultBaseBranch: z.string().optional(),
  createdAt: z.string().optional()
});

const knowledgeDocTypeSchema = z.enum([
  "brief",
  "module_diagram",
  "flow_diagram",
  "architecture_notes",
  "decision_log"
]);

const knowledgeDocStatusSchema = z.enum(["active", "archived"]);
const knowledgeApprovalStatusSchema = z.enum(["draft", "approved", "rejected", "superseded"]);
const knowledgeProposedByTypeSchema = z.enum(["user", "llm", "system"]);

const projectKnowledgeVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  contentMarkdown: z.string().nullable().optional(),
  mermaidSource: z.string().nullable().optional(),
  changeSummary: z.string().nullable().optional(),
  approvalStatus: knowledgeApprovalStatusSchema,
  proposedBy: z.string().nullable().optional(),
  proposedByType: knowledgeProposedByTypeSchema,
  approvedBy: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  sourceTaskId: z.string().nullable().optional(),
  sourceAiRunId: z.string().nullable().optional(),
  baseVersion: z.number().nullable().optional(),
  createdAt: z.string()
});

const projectKnowledgeDocSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  type: knowledgeDocTypeSchema,
  slug: z.string(),
  title: z.string(),
  status: knowledgeDocStatusSchema,
  activeVersion: z.number().nullable().optional(),
  createdBy: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  versions: z.array(projectKnowledgeVersionSchema).optional().default([])
});

const projectKnowledgeOverviewSchema = z.object({
  project: z.object({
    id: z.string(),
    orgId: z.string(),
    name: z.string(),
    key: z.string(),
    description: z.string().nullable().optional(),
    defaultBaseBranch: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
  }),
  brief: z
    .object({
      source: z.string(),
      docId: z.string().nullable().optional(),
      title: z.string(),
      version: z.number().nullable().optional(),
      contentMarkdown: z.string().nullable().optional()
    })
    .nullable(),
  architectureNotes: z
    .object({
      docId: z.string(),
      title: z.string(),
      version: z.number(),
      contentMarkdown: z.string().nullable().optional()
    })
    .nullable(),
  diagrams: z.object({
    moduleCount: z.number(),
    flowCount: z.number()
  }),
  phaseSummary: z.object({
    total: z.number(),
    planned: z.number(),
    inProgress: z.number(),
    blocked: z.number(),
    completed: z.number(),
    archived: z.number()
  }),
  pendingApprovals: z.object({
    docs: z.number(),
    phases: z.number()
  })
});

const projectKnowledgeDocVersionsSchema = z.object({
  docId: z.string(),
  activeVersion: z.number().nullable().optional(),
  status: knowledgeDocStatusSchema,
  versions: z.array(projectKnowledgeVersionSchema).default([])
});

const projectKnowledgeDocCreateResultSchema = z.object({
  doc: projectKnowledgeDocSchema.omit({ versions: true }),
  version: projectKnowledgeVersionSchema
});

const projectKnowledgeDocVersionCreateResultSchema = z.union([
  z.object({
    created: z.literal(false),
    reason: z.literal("version_conflict"),
    docId: z.string(),
    latestApprovedVersion: z.number()
  }),
  z.object({
    created: z.literal(true),
    docId: z.string(),
    activeVersion: z.number().nullable().optional(),
    version: projectKnowledgeVersionSchema
  })
]);

const projectKnowledgeDocVersionApprovalResultSchema = z.union([
  z.object({
    approved: z.literal(false),
    reason: z.enum(["version_not_pending", "version_conflict"]),
    docId: z.string(),
    version: z.number(),
    status: knowledgeApprovalStatusSchema.optional(),
    latestApprovedVersion: z.number().optional()
  }),
  z.object({
    approved: z.literal(true),
    docId: z.string(),
    version: z.number(),
    activeVersion: z.number(),
    approvedAt: z.string()
  })
]);

const projectKnowledgeDocVersionRejectResultSchema = z.union([
  z.object({
    rejected: z.literal(false),
    reason: z.literal("version_not_pending"),
    docId: z.string(),
    version: z.number(),
    status: knowledgeApprovalStatusSchema.optional()
  }),
  z.object({
    rejected: z.literal(true),
    docId: z.string(),
    version: z.number(),
    rejectedAt: z.string()
  })
]);

const projectKnowledgeDocArchiveResultSchema = z.object({
  archived: z.boolean(),
  docId: z.string(),
  status: knowledgeDocStatusSchema
});

const projectPhaseStatusSchema = z.enum([
  "planned",
  "in_progress",
  "blocked",
  "completed",
  "archived"
]);

const projectPhaseRevisionSchema = z.object({
  id: z.string(),
  revision: z.number(),
  payload: z.record(z.unknown()),
  approvalStatus: knowledgeApprovalStatusSchema,
  proposedBy: z.string().nullable().optional(),
  proposedByType: knowledgeProposedByTypeSchema,
  approvedBy: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  sourceTaskId: z.string().nullable().optional(),
  sourceAiRunId: z.string().nullable().optional(),
  baseRevision: z.number().nullable().optional(),
  createdAt: z.string()
});

const projectPhaseSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  key: z.string(),
  name: z.string(),
  objective: z.string().nullable().optional(),
  status: projectPhaseStatusSchema,
  ownerUserId: z.string().nullable().optional(),
  orderIndex: z.number(),
  plannedStartAt: z.string().nullable().optional(),
  plannedEndAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  revisions: z.array(projectPhaseRevisionSchema).default([])
});

const projectPhaseCreateResultSchema = z.object({
  phase: projectPhaseSchema.omit({ revisions: true }),
  revision: projectPhaseRevisionSchema
});

const projectPhaseRevisionCreateResultSchema = z.union([
  z.object({
    created: z.literal(false),
    reason: z.literal("revision_conflict"),
    phaseId: z.string(),
    latestApprovedRevision: z.number()
  }),
  z.object({
    created: z.literal(true),
    phaseId: z.string(),
    latestApprovedRevision: z.number(),
    revision: projectPhaseRevisionSchema
  })
]);

const projectPhaseRevisionApproveResultSchema = z.union([
  z.object({
    approved: z.literal(false),
    reason: z.enum(["revision_not_pending", "revision_conflict"]),
    phaseId: z.string(),
    revision: z.number(),
    status: knowledgeApprovalStatusSchema.optional(),
    latestApprovedRevision: z.number().optional()
  }),
  z.object({
    approved: z.literal(true),
    phaseId: z.string(),
    revision: z.number(),
    approvedAt: z.string()
  })
]);

const projectPhaseReorderResultSchema = z.object({
  reordered: z.boolean(),
  projectId: z.string(),
  phaseIds: z.array(z.string())
});

const repositorySchema = z.object({
  id: z.string(),
  provider: z.string(),
  fullName: z.string(),
  defaultBranch: z.string().optional(),
  isPrivate: z.boolean().optional()
});

const activitySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  userId: z.string(),
  state: z.string(),
  activeFilePath: z.string().nullable().optional(),
  lastSeenAt: z.string()
});

const orgMemberSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  userId: z.string(),
  role: z.string(),
  status: z.string(),
  invitedBy: z.string().nullable().optional(),
  inviteExpiresAt: z.string().nullable().optional(),
  acceptedAt: z.string().nullable().optional(),
  user: z
    .object({
      id: z.string(),
      email: z.string(),
      displayName: z.string().nullable().optional()
    })
    .nullable()
    .optional()
});

const inviteResponseSchema = z.object({
  inviteId: z.string(),
  orgId: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.string(),
  inviteExpiresAt: z.string().nullable().optional(),
  inviteLink: z.string().optional()
});

const projectMemberSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  userId: z.string(),
  role: z.string(),
  status: z.string(),
  user: z
    .object({
      id: z.string(),
      email: z.string(),
      displayName: z.string().nullable().optional()
    })
    .optional()
});

const taskStatusSchema = z.enum(["todo", "in_progress", "blocked", "review", "done", "archived"]);

const pullRequestSummarySchema = z.object({
  id: z.string(),
  number: z.number(),
  status: z.string(),
  url: z.string().optional()
});

const branchSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  createdAt: z.string(),
  pullRequests: z.array(pullRequestSummarySchema).optional().default([])
});

const qualityGateSummarySchema = z.object({
  id: z.string(),
  status: z.string(),
  createdAt: z.string()
});

const handoffSummarySchema = z.object({
  id: z.string(),
  summary: z.string(),
  createdAt: z.string()
});

const taskListItemSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  repositoryId: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  createdAt: z.string(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  branches: z.array(branchSummarySchema).default([]),
  qualityGateRuns: z.array(qualityGateSummarySchema).default([])
});

const taskDetailsSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  repositoryId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  status: taskStatusSchema,
  createdAt: z.string(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  branches: z.array(branchSummarySchema).default([]),
  qualityGateRuns: z.array(qualityGateSummarySchema).default([]),
  handoffPackets: z.array(handoffSummarySchema).default([])
});

const taskPrSliceSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  pullRequestId: z.string(),
  sliceOrder: z.number(),
  title: z.string(),
  description: z.string().nullable().optional(),
  filePaths: z.array(z.string()).default([]),
  riskLevel: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  pullRequest: z.object({
    id: z.string(),
    number: z.number(),
    status: z.string(),
    url: z.string().optional(),
    branch: z.object({
      id: z.string(),
      name: z.string(),
      status: z.string()
    })
  })
});

const taskReviewDigestSchema = z.object({
  taskId: z.string(),
  generatedAt: z.string(),
  digestHash: z.string(),
  riskLevel: z.string(),
  reasonCodes: z.array(z.string()).default([]),
  recommendedAction: z.string(),
  summary: z.object({
    intentEvents: z.number(),
    activityEvents: z.number(),
    openConflicts: z.number(),
    unresolvedHandoffs: z.number(),
    pullRequestCount: z.number(),
    prSliceCount: z.number(),
    latestQualityStatus: z.string().nullable(),
    failedCheckCount: z.number(),
    missingRequiredChecks: z.number()
  }),
  sources: z.object({
    intent: z.object({
      firstEventAt: z.string().nullable(),
      lastEventAt: z.string().nullable()
    }),
    activity: z.object({
      firstSeenAt: z.string().nullable(),
      lastSeenAt: z.string().nullable()
    }),
    quality: z.object({
      latestRunId: z.string().nullable(),
      latestStatus: z.string().nullable(),
      failedChecks: z.array(z.string()).default([]),
      requiredChecks: z.array(z.string()).default([]),
      missingRequiredChecks: z.array(z.string()).default([])
    }),
    handoff: z.object({
      count: z.number(),
      unresolvedCount: z.number()
    }),
    conflicts: z.object({
      count: z.number(),
      criticalCount: z.number(),
      highCount: z.number()
    })
  }),
  pullRequests: z.array(
    z.object({
      id: z.string(),
      number: z.number(),
      status: z.string(),
      url: z.string().optional(),
      branchName: z.string()
    })
  ),
  slices: z.array(
    z.object({
      id: z.string(),
      pullRequestId: z.string(),
      pullRequestNumber: z.number(),
      pullRequestStatus: z.string(),
      branchName: z.string(),
      sliceOrder: z.number(),
      title: z.string(),
      description: z.string().nullable().optional(),
      riskLevel: z.string(),
      status: z.string(),
      filePaths: z.array(z.string()).default([]),
      createdAt: z.string()
    })
  )
});

const replaySchema = z.object({
  taskId: z.string(),
  snapshotVersion: z.number(),
  generatedAt: z.string(),
  steps: z.array(z.string())
});

const conflictSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  taskId: z.string().nullable().optional(),
  otherTaskId: z.string().nullable().optional(),
  severity: z.string(),
  score: z.union([z.number(), z.string()]).transform((value) => Number(value)),
  filePaths: z.array(z.string()),
  symbolNames: z.array(z.string()),
  reasonCodes: z.array(z.string()).optional(),
  suggestedAction: z.string().optional(),
  resolutionStatus: z.string(),
  createdAt: z.string()
});

const qualityRunSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  branchId: z.string().nullable().optional(),
  triggerSource: z.string(),
  status: z.string(),
  createdAt: z.string(),
  checks: z
    .array(
      z.object({
        id: z.string(),
        checkKey: z.string(),
        status: z.string(),
        durationMs: z.number().nullable().optional()
      })
    )
    .default([])
});

const qualityRunDetailsSchema = qualityRunSchema.extend({
  artifactCount: z.number().optional(),
  checksSummary: z
    .object({
      queued: z.number(),
      running: z.number(),
      passed: z.number(),
      failed: z.number(),
      canceled: z.number()
    })
    .optional()
});

const qualityArtifactSchema = z.object({
  id: z.string(),
  runId: z.string(),
  checkId: z.string().nullable().optional(),
  checkKey: z.string().nullable().optional(),
  checkStatus: z.string().nullable().optional(),
  artifactType: z.string(),
  storageProvider: z.string(),
  storageKey: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  retentionClass: z.string(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string()
});

const githubInstallationStatusSchema = z.object({
  orgId: z.string(),
  projectId: z.string().optional(),
  repositoryCount: z.number(),
  installations: z.array(
    z.object({
      id: z.string(),
      githubInstallationId: z.number(),
      accountLogin: z.string(),
      accountType: z.string(),
      installedAt: z.string(),
      uninstalledAt: z.string().nullable().optional(),
      updatedAt: z.string()
    })
  ),
  repositories: z.array(
    z.object({
      id: z.string(),
      fullName: z.string(),
      defaultBranch: z.string(),
      githubInstallationId: z.number().nullable()
    })
  )
});

const branchAutomationStatusSchema = z.object({
  orgId: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  branchId: z.string(),
  branchName: z.string(),
  repositoryId: z.string(),
  repositoryProvider: z.string(),
  policy: z.object({
    baseBranch: z.string(),
    protectedBranches: z.array(z.string()),
    autoPush: z.boolean(),
    autoPr: z.boolean(),
    staleThresholdMinutes: z.number(),
    cleanupAfterMergeHours: z.number(),
    requiredQualityChecks: z.array(z.string()),
    enforceGuardrailRecheckOnPromote: z.boolean()
  }),
  pullRequest: z
    .object({
      id: z.string(),
      number: z.number(),
      status: z.string(),
      isDraft: z.boolean(),
      mergeableState: z.string().nullable().optional()
    })
    .nullable(),
  blockingReasons: z.array(z.string()),
  requiredQualityChecks: z.array(z.string()),
  missingRequiredChecks: z.array(z.string())
});

const pivotReportSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  effectiveAt: z.string(),
  createdAt: z.string(),
  staleReports: z.array(
    z.object({
      id: z.string(),
      entityType: z.string(),
      entityId: z.string(),
      reason: z.string(),
      status: z.string()
    })
  )
});

const provenanceGraphSchema = z.object({
  taskId: z.string(),
  generatedAt: z.string(),
  counts: z.object({
    nodes: z.number(),
    edges: z.number(),
    intentEvents: z.number(),
    decisions: z.number(),
    aiRuns: z.number(),
    qualityRuns: z.number(),
    handoffs: z.number(),
    conflicts: z.number()
  }),
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      label: z.string(),
      timestamp: z.string().optional()
    })
  ),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      type: z.string()
    })
  )
});

const integrationConnectionSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string().nullable().optional(),
  provider: z.string(),
  authType: z.string().optional(),
  status: z.string(),
  credentialVersion: z.number().optional(),
  lastHealthStatus: z.string().optional(),
  lastHealthCheckedAt: z.string().nullable().optional(),
  tokenExpiresAt: z.string().nullable().optional(),
  lastErrorCode: z.string().nullable().optional(),
  lastErrorMessage: z.string().nullable().optional(),
  createdAt: z.string().optional()
});

const integrationHealthSchema = z.object({
  id: z.string(),
  provider: z.string(),
  healthy: z.boolean(),
  status: z.string(),
  checkedAt: z.string()
});

const integrationConnectionStatusSchema = z.object({
  id: z.string().optional(),
  provider: z.string().optional(),
  status: z.string(),
  healthy: z.boolean().optional(),
  requiresReauth: z.boolean().optional(),
  tokenExpiresAt: z.string().nullable().optional(),
  lastHealthStatus: z.string().optional(),
  lastErrorCode: z.string().nullable().optional(),
  lastErrorMessage: z.string().nullable().optional(),
  checkedAt: z.string().optional()
});

const realtimeLatencySchema = z.object({
  projectId: z.string(),
  windowMinutes: z.number(),
  sampleCount: z.number(),
  p50Ms: z.number(),
  p95Ms: z.number(),
  maxMs: z.number(),
  targetP95Ms: z.number(),
  withinTarget: z.boolean(),
  generatedAt: z.string()
});

const oauthStartResponseSchema = z.object({
  started: z.boolean(),
  connectionId: z.string(),
  provider: z.string(),
  status: z.string(),
  authorizeUrl: z.string().url(),
  expiresAt: z.string()
});

const promptTemplateSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string().nullable().optional(),
  name: z.string(),
  slug: z.string(),
  category: z.string(),
  isActive: z.boolean(),
  versions: z
    .array(
      z.object({
        id: z.string(),
        version: z.number(),
        createdAt: z.string()
      })
    )
    .default([])
});

const promptUsageAnalyticsSchema = z.object({
  orgId: z.string(),
  projectId: z.string().nullable().optional(),
  sinceDays: z.number(),
  totalUsage: z.number(),
  templates: z.array(
    z.object({
      templateId: z.string(),
      name: z.string(),
      slug: z.string(),
      usageCount: z.number(),
      averageRating: z.number().nullable(),
      versions: z.record(z.number())
    })
  )
});

export const projectPolicySchema = z.object({
  baseBranch: z.string(),
  protectedBranches: z.array(z.string()),
  autoPush: z.boolean(),
  autoPr: z.boolean(),
  staleThresholdMinutes: z.number(),
  cleanupAfterMergeHours: z.number(),
  requiredQualityChecks: z
    .array(
      z.enum(["build", "unit_tests", "lint", "dependency_audit", "integration_tests"])
    )
    .default(["build", "unit_tests", "lint", "dependency_audit"]),
  enforceGuardrailRecheckOnPromote: z.boolean().default(true)
});

const guardrailRuleSchema = z.object({
  id: z.string(),
  ruleKey: z.string(),
  ruleType: z.string(),
  severity: z.string(),
  expression: z.record(z.unknown()),
  enabled: z.boolean(),
  createdAt: z.string().optional()
});

const guardrailPolicySetSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  name: z.string(),
  version: z.number(),
  status: z.string(),
  config: z.record(z.unknown()).optional(),
  createdBy: z.string().optional(),
  createdAt: z.string().optional(),
  rules: z.array(guardrailRuleSchema).optional().default([])
});

export interface ActiveScope {
  organizations: Array<z.infer<typeof organizationSchema>>;
  projects: Array<z.infer<typeof projectSchema>>;
  orgId?: string;
  projectId?: string;
}

async function getAuthHeader() {
  if (!isClerkConfigured()) {
    if (e2eBearerToken) {
      return {
        authorization: `Bearer ${e2eBearerToken}`
      };
    }
    throw new Error(missingClerkConfigMessage);
  }

  try {
    const sessionAuth = await auth();
    const token = await sessionAuth.getToken(
      apiTokenTemplate ? { template: apiTokenTemplate } : undefined
    );
    if (token) {
      return {
        authorization: `Bearer ${token}`
      };
    }
  } catch {
    // Fall through to deterministic e2e token fallback.
  }

  if (e2eBearerToken) {
    return {
      authorization: `Bearer ${e2eBearerToken}`
    };
  }

  throw new Error("Missing authenticated Clerk session token");
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      ...(await getAuthHeader()),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    let reason = text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string };
        if (typeof parsed.message === "string" && parsed.message.length > 0) {
          reason = parsed.message;
        } else if (typeof parsed.error === "string" && parsed.error.length > 0) {
          reason = parsed.error;
        }
      } catch {
        // Keep raw text fallback.
      }
    }
    throw new Error(`API request failed (${response.status}) for ${path}: ${reason || "unknown error"}`);
  }

  return response.json();
}

export async function fetchOrganizations() {
  const data = await requestJson("/orgs");
  return z.array(organizationSchema).parse(data);
}

export async function createOrganization(input: { name: string; slug: string }) {
  const data = await requestJson("/orgs", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return organizationCreateSchema.parse(data);
}

export async function fetchProjects(orgId: string) {
  const data = await requestJson(`/projects/${orgId}`);
  return z.array(projectSchema).parse(data);
}

export async function createProject(input: {
  orgId: string;
  name: string;
  key: string;
  baseBranch?: string;
}) {
  const data = await requestJson("/projects", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      ...input,
      baseBranch: input.baseBranch ?? "main"
    })
  });

  return projectCreateSchema.parse(data);
}

export async function fetchProjectKnowledgeOverview(projectId: string, includeArchived?: boolean) {
  const search = new URLSearchParams();
  if (includeArchived) {
    search.set("includeArchived", "true");
  }
  const query = search.size > 0 ? `?${search.toString()}` : "";
  const data = await requestJson(`/projects/${projectId}/knowledge/overview${query}`);
  return projectKnowledgeOverviewSchema.parse(data);
}

export async function fetchProjectKnowledgeDocs(projectId: string) {
  const data = await requestJson(`/projects/${projectId}/knowledge/docs`);
  return z.array(projectKnowledgeDocSchema).parse(data);
}

export async function createProjectKnowledgeDoc(
  projectId: string,
  input: {
    type: z.infer<typeof knowledgeDocTypeSchema>;
    title: string;
    slug?: string;
    contentMarkdown?: string;
    mermaidSource?: string;
    changeSummary?: string;
    proposedByType?: z.infer<typeof knowledgeProposedByTypeSchema>;
    sourceTaskId?: string;
    sourceAiRunId?: string;
  }
) {
  const data = await requestJson(`/projects/${projectId}/knowledge/docs`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return projectKnowledgeDocCreateResultSchema.parse(data);
}

export async function fetchProjectKnowledgeDocVersions(projectId: string, docId: string) {
  const data = await requestJson(`/projects/${projectId}/knowledge/docs/${docId}/versions`);
  return projectKnowledgeDocVersionsSchema.parse(data);
}

export async function proposeProjectKnowledgeDocVersion(
  projectId: string,
  docId: string,
  input: {
    contentMarkdown?: string;
    mermaidSource?: string;
    changeSummary?: string;
    proposedByType?: z.infer<typeof knowledgeProposedByTypeSchema>;
    sourceTaskId?: string;
    sourceAiRunId?: string;
    baseVersion?: number;
  }
) {
  const data = await requestJson(`/projects/${projectId}/knowledge/docs/${docId}/versions`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return projectKnowledgeDocVersionCreateResultSchema.parse(data);
}

export async function approveProjectKnowledgeDocVersion(
  projectId: string,
  docId: string,
  version: number,
  expectedBaseVersion?: number
) {
  const data = await requestJson(`/projects/${projectId}/knowledge/docs/${docId}/versions/${version}/approve`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      expectedBaseVersion
    })
  });
  return projectKnowledgeDocVersionApprovalResultSchema.parse(data);
}

export async function rejectProjectKnowledgeDocVersion(
  projectId: string,
  docId: string,
  version: number
) {
  const data = await requestJson(`/projects/${projectId}/knowledge/docs/${docId}/versions/${version}/reject`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  });
  return projectKnowledgeDocVersionRejectResultSchema.parse(data);
}

export async function archiveProjectKnowledgeDoc(projectId: string, docId: string) {
  const data = await requestJson(`/projects/${projectId}/knowledge/docs/${docId}/archive`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  });
  return projectKnowledgeDocArchiveResultSchema.parse(data);
}

export async function fetchProjectPhases(projectId: string) {
  const data = await requestJson(`/projects/${projectId}/phases`);
  return z.array(projectPhaseSchema).parse(data);
}

export async function createProjectPhase(
  projectId: string,
  input: {
    key: string;
    name: string;
    objective?: string | null;
    status?: z.infer<typeof projectPhaseStatusSchema>;
    ownerUserId?: string | null;
    orderIndex?: number;
    plannedStartAt?: string | null;
    plannedEndAt?: string | null;
    completedAt?: string | null;
    proposedByType?: z.infer<typeof knowledgeProposedByTypeSchema>;
    sourceTaskId?: string;
    sourceAiRunId?: string;
  }
) {
  const data = await requestJson(`/projects/${projectId}/phases`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return projectPhaseCreateResultSchema.parse(data);
}

export async function proposeProjectPhaseRevision(
  projectId: string,
  phaseId: string,
  input: {
    name?: string;
    objective?: string | null;
    status?: z.infer<typeof projectPhaseStatusSchema>;
    ownerUserId?: string | null;
    orderIndex?: number;
    plannedStartAt?: string | null;
    plannedEndAt?: string | null;
    completedAt?: string | null;
    changeSummary?: string;
    proposedByType?: z.infer<typeof knowledgeProposedByTypeSchema>;
    sourceTaskId?: string;
    sourceAiRunId?: string;
    baseRevision?: number;
  }
) {
  const data = await requestJson(`/projects/${projectId}/phases/${phaseId}/revisions`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return projectPhaseRevisionCreateResultSchema.parse(data);
}

export async function approveProjectPhaseRevision(
  projectId: string,
  phaseId: string,
  revision: number,
  expectedBaseRevision?: number
) {
  const data = await requestJson(`/projects/${projectId}/phases/${phaseId}/revisions/${revision}/approve`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      expectedBaseRevision
    })
  });
  return projectPhaseRevisionApproveResultSchema.parse(data);
}

export async function reorderProjectPhases(projectId: string, phaseIds: string[]) {
  const data = await requestJson(`/projects/${projectId}/phases/reorder`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      phaseIds
    })
  });
  return projectPhaseReorderResultSchema.parse(data);
}

export async function fetchRepositories(projectId: string) {
  const search = new URLSearchParams({ projectId });
  const data = await requestJson(`/repositories?${search.toString()}`);
  return z.array(repositorySchema).parse(data);
}

export async function fetchOrgMembers(orgId: string, status?: "active" | "invited" | "revoked" | "expired") {
  const search = new URLSearchParams({
    orgId
  });
  if (status) {
    search.set("status", status);
  }
  const data = await requestJson(`/memberships/org-members?${search.toString()}`);
  return z.array(orgMemberSchema).parse(data);
}

export async function issueOrgInvite(input: {
  orgId: string;
  email: string;
  role: "owner" | "admin" | "member" | "viewer";
  expiresInDays?: number;
}) {
  const data = await requestJson("/memberships/invite", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return inviteResponseSchema.parse(data);
}

export async function acceptOrgInvite(inviteId: string) {
  const data = await requestJson("/memberships/accept", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      inviteId
    })
  });

  return z
    .object({
      id: z.string(),
      orgId: z.string(),
      role: z.string(),
      status: z.string()
    })
    .parse(data);
}

export async function revokeOrgInvite(inviteId: string) {
  const data = await requestJson("/memberships/revoke", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      inviteId
    })
  });

  return z.object({ id: z.string(), status: z.string() }).parse(data);
}

export async function updateOrgMemberRole(
  membershipId: string,
  role: "owner" | "admin" | "member" | "viewer"
) {
  const data = await requestJson(`/memberships/${membershipId}/role`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      role
    })
  });

  return orgMemberSchema.partial().parse(data);
}

export async function fetchProjectMembers(projectId: string) {
  const search = new URLSearchParams({
    projectId
  });
  const data = await requestJson(`/memberships/project-members?${search.toString()}`);
  return z.array(projectMemberSchema).parse(data);
}

export async function addProjectMember(input: {
  projectId: string;
  userId: string;
  role: "admin" | "member" | "viewer";
}) {
  const data = await requestJson("/memberships/project-members", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return projectMemberSchema.partial().parse(data);
}

export async function updateProjectMember(input: {
  memberId: string;
  role: "admin" | "member" | "viewer";
  status?: "active" | "inactive";
}) {
  const data = await requestJson(`/memberships/project-members/${input.memberId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      role: input.role,
      status: input.status ?? "active"
    })
  });

  return projectMemberSchema.partial().parse(data);
}

export async function removeProjectMember(memberId: string) {
  const data = await requestJson(`/memberships/project-members/${memberId}`, {
    method: "DELETE"
  });

  return z.object({ ok: z.boolean(), id: z.string() }).parse(data);
}

export async function fetchProjectPolicy(projectId: string) {
  const data = await requestJson(`/projects/${projectId}/policy`);
  return projectPolicySchema.parse(data);
}

export async function updateProjectPolicy(
  projectId: string,
  policy: Partial<z.infer<typeof projectPolicySchema>>
) {
  const data = await requestJson(`/projects/${projectId}/policy`, {
    method: "PUT",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(policy)
  });

  return projectPolicySchema.parse(data);
}

export async function fetchGuardrailPolicies(input: {
  projectId: string;
  name?: string;
  includeRules?: boolean;
}) {
  const search = new URLSearchParams({
    projectId: input.projectId,
    name: input.name ?? "default",
    includeRules: input.includeRules ? "true" : "false"
  });

  const data = await requestJson(`/guardrails/policies?${search.toString()}`);
  return z.array(guardrailPolicySetSchema).parse(data);
}

export async function activateGuardrailPolicyVersion(input: {
  projectId: string;
  name?: string;
  version: number;
}) {
  const data = await requestJson("/guardrails/policies/activate", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      projectId: input.projectId,
      name: input.name ?? "default",
      version: input.version
    })
  });

  return z
    .object({
      id: z.string(),
      projectId: z.string(),
      name: z.string(),
      version: z.number(),
      status: z.string()
    })
    .parse(data);
}

export async function fetchPresence(projectId: string) {
  const data = await requestJson(`/activity/presence?projectId=${projectId}`);
  return z.array(activitySchema).parse(data);
}

export async function fetchTasks(input: {
  projectId: string;
  status?: z.infer<typeof taskStatusSchema>;
  limit?: number;
}) {
  const search = new URLSearchParams({
    projectId: input.projectId
  });
  if (input.status) {
    search.set("status", input.status);
  }
  if (typeof input.limit === "number") {
    search.set("limit", String(input.limit));
  }

  const data = await requestJson(`/tasks?${search.toString()}`);
  return z.array(taskListItemSchema).parse(data);
}

export async function fetchTask(taskId: string) {
  const data = await requestJson(`/tasks/${taskId}`);
  return taskDetailsSchema.parse(data);
}

export async function fetchReplay(taskId: string) {
  const data = await requestJson(`/replay/${taskId}`);
  return replaySchema.parse(data);
}

export async function fetchTaskConflicts(taskId: string) {
  const data = await requestJson(`/tasks/${taskId}/conflicts`);
  return z.array(conflictSummarySchema).parse(data);
}

export async function fetchTaskHandoffs(taskId: string) {
  const data = await requestJson(`/tasks/${taskId}/handoffs`);
  return z.array(handoffSummarySchema.extend({ taskId: z.string() })).parse(data);
}

export async function fetchTaskPrSlices(taskId: string) {
  const data = await requestJson(`/tasks/${taskId}/pr-slices`);
  return z.array(taskPrSliceSchema).parse(data);
}

export async function fetchTaskReviewDigest(taskId: string) {
  const data = await requestJson(`/tasks/${taskId}/review-digest`);
  return taskReviewDigestSchema.parse(data);
}

export async function acknowledgeTaskHandoff(handoffId: string, notes?: string) {
  const data = await requestJson(`/handoffs/${handoffId}/ack`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      notes
    })
  });

  return z
    .object({
      handoffPacketId: z.string().optional(),
      ackBy: z.string().optional(),
      notes: z.string().nullable().optional()
    })
    .parse(data);
}

export async function claimConflictOwnership(input: {
  orgId: string;
  projectId: string;
  taskId: string;
  scopeType?: string;
  scopeValue: string;
  ttlMinutes?: number;
}) {
  const data = await requestJson("/conflicts/claims", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      ...input,
      scopeType: input.scopeType ?? "file"
    })
  });

  return z
    .object({
      id: z.string(),
      scopeType: z.string(),
      scopeValue: z.string(),
      expiresAt: z.string()
    })
    .parse(data);
}

export async function fetchQualityRuns(input: {
  projectId?: string;
  taskId?: string;
  limit?: number;
}) {
  const search = new URLSearchParams();
  if (input.projectId) {
    search.set("projectId", input.projectId);
  }
  if (input.taskId) {
    search.set("taskId", input.taskId);
  }
  if (typeof input.limit === "number") {
    search.set("limit", String(input.limit));
  }
  const data = await requestJson(`/quality-gates?${search.toString()}`);
  return z.array(qualityRunSchema).parse(data);
}

export async function fetchQualityRun(runId: string) {
  const data = await requestJson(`/quality-gates/${runId}`);
  return qualityRunDetailsSchema.parse(data);
}

export async function fetchQualityArtifacts(runId: string, includeMetadata = false) {
  const search = new URLSearchParams({
    includeMetadata: includeMetadata ? "true" : "false"
  });
  const data = await requestJson(`/quality-gates/${runId}/artifacts?${search.toString()}`);
  return z.array(qualityArtifactSchema).parse(data);
}

export async function fetchGithubInstallationStatus(orgId: string, projectId?: string) {
  const search = new URLSearchParams({
    orgId
  });
  if (projectId) {
    search.set("projectId", projectId);
  }
  const data = await requestJson(`/github/installations/status?${search.toString()}`);
  return githubInstallationStatusSchema.parse(data);
}

export async function reconcileGithubState(input?: { orgId?: string; projectId?: string; limit?: number }) {
  const data = await requestJson("/github/reconcile", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input ?? {})
  });

  return z
    .object({
      scanned: z.number(),
      reconciled: z.number(),
      failed: z.number(),
      skipped: z.number()
    })
    .parse(data);
}

export async function fetchBranchAutomationStatus(branchId: string) {
  const data = await requestJson(`/branches/${branchId}/automation-status`);
  return branchAutomationStatusSchema.parse(data);
}

export async function mergeBranch(
  branchId: string,
  input?: {
    strategy?: "squash" | "merge" | "rebase";
    requireOpenPr?: boolean;
    openDraftIfNeeded?: boolean;
  }
) {
  const data = await requestJson(`/branches/${branchId}/merge`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input ?? {})
  });

  return z
    .object({
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
    })
    .parse(data);
}

export async function fetchPivotReports(projectId: string, limit?: number) {
  const search = new URLSearchParams({
    projectId
  });
  if (typeof limit === "number") {
    search.set("limit", String(limit));
  }
  const data = await requestJson(`/pivot/reports?${search.toString()}`);
  return z.array(pivotReportSchema).parse(data);
}

export async function fetchProvenanceGraph(taskId: string) {
  const data = await requestJson(`/provenance/graph?taskId=${taskId}`);
  return provenanceGraphSchema.parse(data);
}

export async function fetchIntegrationConnections(orgId: string, projectId?: string) {
  const search = new URLSearchParams({
    orgId
  });
  if (projectId) {
    search.set("projectId", projectId);
  }

  const data = await requestJson(`/integrations/connections?${search.toString()}`);
  return z.array(integrationConnectionSchema).parse(data);
}

export async function fetchIntegrationHealth(connectionId: string, orgId: string) {
  const data = await requestJson(`/integrations/connections/${connectionId}/health?orgId=${orgId}`);
  return integrationHealthSchema.parse(data);
}

export async function fetchIntegrationConnectionStatus(connectionId: string, orgId: string) {
  const data = await requestJson(`/integrations/connections/${connectionId}/status?orgId=${orgId}`);
  return integrationConnectionStatusSchema.parse(data);
}

export async function fetchPromptTemplates(orgId: string, projectId?: string) {
  const search = new URLSearchParams({
    orgId
  });
  if (projectId) {
    search.set("projectId", projectId);
  }
  const data = await requestJson(`/prompt-library/templates?${search.toString()}`);
  return z.array(promptTemplateSchema).parse(data);
}

export async function fetchPromptUsageAnalytics(input: {
  orgId: string;
  projectId?: string;
  sinceDays?: number;
}) {
  const search = new URLSearchParams({
    orgId: input.orgId
  });
  if (input.projectId) {
    search.set("projectId", input.projectId);
  }
  if (typeof input.sinceDays === "number") {
    search.set("sinceDays", String(input.sinceDays));
  }
  const data = await requestJson(`/prompt-library/usage?${search.toString()}`);
  return promptUsageAnalyticsSchema.parse(data);
}

export async function startIntegrationOauth(input: {
  orgId: string;
  projectId?: string;
  provider: "slack" | "linear" | "jira";
  connectionId?: string;
  returnPath?: string;
}) {
  const data = await requestJson("/integrations/oauth/start", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return oauthStartResponseSchema.parse(data);
}

export async function reauthorizeIntegrationConnection(input: {
  connectionId: string;
  orgId: string;
  returnPath?: string;
}) {
  const data = await requestJson(`/integrations/connections/${input.connectionId}/reauthorize`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      orgId: input.orgId,
      returnPath: input.returnPath
    })
  });

  return oauthStartResponseSchema.parse(data);
}

export async function unlinkIntegrationConnection(input: {
  connectionId: string;
  orgId: string;
  cascadeLinks?: boolean;
}) {
  const data = await requestJson(`/integrations/connections/${input.connectionId}/unlink`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      orgId: input.orgId,
      cascadeLinks: input.cascadeLinks ?? true
    })
  });

  return z
    .object({
      unlinked: z.boolean(),
      id: z.string().optional(),
      status: z.string().optional()
    })
    .parse(data);
}

export async function exportAuditLog(input: { orgId: string; projectId?: string; limit?: number }) {
  const search = new URLSearchParams({
    orgId: input.orgId
  });
  if (input.projectId) {
    search.set("projectId", input.projectId);
  }
  if (typeof input.limit === "number") {
    search.set("limit", String(input.limit));
  }
  const data = await requestJson(`/audit/export?${search.toString()}`);
  return z
    .object({
      generatedAt: z.string(),
      count: z.number(),
      digest: z.string()
    })
    .parse(data);
}

export async function verifyAuditLog(input: { orgId: string; projectId?: string; limit?: number }) {
  const search = new URLSearchParams({
    orgId: input.orgId
  });
  if (input.projectId) {
    search.set("projectId", input.projectId);
  }
  if (typeof input.limit === "number") {
    search.set("limit", String(input.limit));
  }
  const data = await requestJson(`/audit/verify?${search.toString()}`);
  return z
    .object({
      verifiedAt: z.string(),
      checkedRecords: z.number(),
      valid: z.boolean(),
      mismatchCount: z.number()
    })
    .parse(data);
}

export async function fetchRedactionPolicy(orgId: string) {
  const search = new URLSearchParams({
    orgId
  });
  const data = await requestJson(`/audit/redaction-policy?${search.toString()}`);
  return z
    .object({
      orgId: z.string(),
      capturePromptText: z.boolean(),
      captureCodeSnippets: z.boolean(),
      redactionPatterns: z.array(z.string()).default([])
    })
    .parse(data);
}

export async function fetchRetentionPolicy(orgId: string, projectId?: string) {
  const search = new URLSearchParams({
    orgId
  });
  if (projectId) {
    search.set("projectId", projectId);
  }
  const data = await requestJson(`/audit/retention-policy?${search.toString()}`);
  return z
    .object({
      orgId: z.string(),
      projectId: z.string().nullable().optional(),
      intentEventsDays: z.number(),
      activityEventsDays: z.number(),
      qualityArtifactsDays: z.number(),
      auditLogsDays: z.number()
    })
    .parse(data);
}

export async function runRetentionPolicy(orgId: string, projectId?: string) {
  const data = await requestJson("/audit/retention/run", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      orgId,
      projectId
    })
  });

  return z
    .object({
      runAt: z.string(),
      deleted: z.object({
        intentEvents: z.number(),
        activityEvents: z.number(),
        qualityArtifacts: z.number()
      })
    })
    .parse(data);
}

export async function fetchQueueDepth() {
  const data = await requestJson("/observability/queues");
  return z
    .object({
      at: z.string(),
      queues: z.array(
        z.object({
          name: z.string(),
          active: z.number(),
          waiting: z.number(),
          failed: z.number(),
          completed: z.number(),
          delayed: z.number()
        })
      )
    })
    .parse(data);
}

export async function fetchRealtimeLatency(input: { projectId: string; windowMinutes?: number }) {
  const search = new URLSearchParams({
    projectId: input.projectId
  });
  if (typeof input.windowMinutes === "number") {
    search.set("windowMinutes", String(input.windowMinutes));
  }
  const data = await requestJson(`/observability/realtime-latency?${search.toString()}`);
  return realtimeLatencySchema.parse(data);
}

export async function resolveActiveScope(): Promise<ActiveScope> {
  if (!isClerkConfigured() && !e2eBearerToken) {
    return {
      organizations: [],
      projects: []
    };
  }

  const organizations = await fetchOrganizations();
  const cookieStore = await cookies();
  const orgCookie = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const orgId = organizations.find((org) => org.id === orgCookie)?.id ?? organizations[0]?.id;

  if (!orgId) {
    return {
      organizations,
      projects: []
    };
  }

  const projects = await fetchProjects(orgId);
  const projectCookie = cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value;
  const projectId = projects.find((project) => project.id === projectCookie)?.id ?? projects[0]?.id;

  return {
    organizations,
    projects,
    orgId,
    projectId
  };
}

export async function setActiveScopeCookies(input: { orgId: string; projectId?: string }) {
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === "production";

  cookieStore.set(ACTIVE_ORG_COOKIE, input.orgId, {
    secure,
    sameSite: "lax",
    path: "/",
    httpOnly: true
  });

  if (input.projectId) {
    cookieStore.set(ACTIVE_PROJECT_COOKIE, input.projectId, {
      secure,
      sameSite: "lax",
      path: "/",
      httpOnly: true
    });
  } else {
    cookieStore.delete(ACTIVE_PROJECT_COOKIE);
  }
}
