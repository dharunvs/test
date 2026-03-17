const http = require("node:http");
const { randomUUID } = require("node:crypto");

const port = Number(process.env.PLAYWRIGHT_API_PORT ?? 4100);
const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3100);
const expectedBearerToken = process.env.BRANCHLINE_E2E_BEARER_TOKEN ?? "branchline-e2e-token";
const now = new Date().toISOString();

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const REPOSITORY_ID = "33333333-3333-3333-3333-333333333333";
const TASK_ID = "44444444-4444-4444-4444-444444444444";
const BRANCH_ID = "55555555-5555-5555-5555-555555555555";
const RUN_ID = "66666666-6666-6666-6666-666666666666";
const HANDOFF_ID = "77777777-7777-7777-7777-777777777777";
const CONFLICT_ID = "88888888-8888-8888-8888-888888888888";
const CONNECTION_ID = "99999999-9999-9999-9999-999999999999";

const state = {
  organizations: [
    {
      id: ORG_ID,
      name: "Branchline Labs",
      slug: "branchline-labs",
      role: "owner"
    }
  ],
  projectsByOrg: {
    [ORG_ID]: [
      {
        id: PROJECT_ID,
        orgId: ORG_ID,
        name: "Console MVP",
        key: "MVP",
        defaultBaseBranch: "main"
      }
    ]
  },
  orgMembers: [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      orgId: ORG_ID,
      userId: "user-owner",
      role: "owner",
      status: "active",
      invitedBy: null,
      inviteExpiresAt: null,
      acceptedAt: now,
      user: {
        id: "user-owner",
        email: "owner@branchline.dev",
        displayName: "Owner User"
      }
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      orgId: ORG_ID,
      userId: "user-invited",
      role: "member",
      status: "invited",
      invitedBy: "user-owner",
      inviteExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      acceptedAt: null,
      user: {
        id: "user-invited",
        email: "invitee@branchline.dev",
        displayName: "Invited User"
      }
    }
  ],
  projectMembersByProject: {
    [PROJECT_ID]: [
      {
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        projectId: PROJECT_ID,
        userId: "user-owner",
        role: "admin",
        status: "active",
        user: {
          id: "user-owner",
          email: "owner@branchline.dev",
          displayName: "Owner User"
        }
      }
    ]
  },
  repositoriesByProject: {
    [PROJECT_ID]: [
      {
        id: REPOSITORY_ID,
        provider: "github",
        fullName: "branchline/console-mvp",
        defaultBranch: "main",
        isPrivate: true
      }
    ]
  },
  githubInstallations: [
    {
      id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      githubInstallationId: 123456,
      accountLogin: "branchline",
      accountType: "Organization",
      installedAt: now,
      uninstalledAt: null,
      updatedAt: now
    }
  ],
  projectPolicy: {
    baseBranch: "main",
    protectedBranches: ["main", "release"],
    autoPush: true,
    autoPr: true,
    staleThresholdMinutes: 120,
    cleanupAfterMergeHours: 24,
    requiredQualityChecks: ["build", "unit_tests", "lint"],
    enforceGuardrailRecheckOnPromote: true
  },
  guardrailPolicies: [
    {
      id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      name: "default",
      version: 3,
      status: "active",
      config: {
        maxChangedFiles: 40
      },
      createdBy: "user-owner",
      createdAt: now,
      rules: [
        {
          id: "rule-1",
          ruleKey: "required-path-prefix",
          ruleType: "path_prefix_require",
          severity: "warn",
          expression: {
            prefix: "apps/"
          },
          enabled: true,
          createdAt: now
        }
      ]
    },
    {
      id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      name: "default",
      version: 2,
      status: "inactive",
      config: {
        maxChangedFiles: 20
      },
      createdBy: "user-owner",
      createdAt: now,
      rules: [
        {
          id: "rule-2",
          ruleKey: "banned-path-prefix",
          ruleType: "path_prefix_block",
          severity: "fail",
          expression: {
            prefix: "infra/"
          },
          enabled: true,
          createdAt: now
        }
      ]
    }
  ],
  tasks: [
    {
      id: TASK_ID,
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      repositoryId: REPOSITORY_ID,
      title: "Implement MVP operator flow",
      status: "in_progress",
      createdAt: now,
      startedAt: now,
      completedAt: null,
      branches: [
        {
          id: BRANCH_ID,
          name: "task/mvp-operator-flow",
          status: "active",
          createdAt: now,
          pullRequests: [
            {
              id: "pr-1",
              number: 42,
              status: "open",
              url: "https://github.com/branchline/console-mvp/pull/42"
            }
          ]
        }
      ],
      qualityGateRuns: [
        {
          id: RUN_ID,
          status: "passed",
          createdAt: now
        }
      ]
    }
  ],
  taskDetailsById: {
    [TASK_ID]: {
      id: TASK_ID,
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      repositoryId: REPOSITORY_ID,
      title: "Implement MVP operator flow",
      description: "Tie together policy, conflicts, quality and handoff workflows",
      status: "in_progress",
      createdAt: now,
      startedAt: now,
      completedAt: null,
      branches: [
        {
          id: BRANCH_ID,
          name: "task/mvp-operator-flow",
          status: "active",
          createdAt: now,
          pullRequests: [
            {
              id: "pr-1",
              number: 42,
              status: "open",
              url: "https://github.com/branchline/console-mvp/pull/42"
            }
          ]
        }
      ],
      qualityGateRuns: [
        {
          id: RUN_ID,
          status: "passed",
          createdAt: now
        }
      ],
      handoffPackets: [
        {
          id: HANDOFF_ID,
          summary: "Resume on quality artifact review and PR handoff",
          createdAt: now
        }
      ]
    }
  },
  conflictsByTask: {
    [TASK_ID]: [
      {
        id: CONFLICT_ID,
        projectId: PROJECT_ID,
        taskId: TASK_ID,
        otherTaskId: "abababab-abab-abab-abab-abababababab",
        severity: "high",
        score: 82,
        filePaths: ["apps/web-console/app/tasks/page.tsx", "apps/web-console/app/quality/page.tsx"],
        symbolNames: ["TasksPage", "QualityPage"],
        reasonCodes: ["file_overlap", "symbol_overlap", "dense_change_overlap"],
        suggestedAction: "split_work_or_rebase_before_merge",
        resolutionStatus: "open",
        createdAt: now
      }
    ]
  },
  handoffsByTask: {
    [TASK_ID]: [
      {
        id: HANDOFF_ID,
        taskId: TASK_ID,
        summary: "Resume on quality artifact review and PR handoff",
        createdAt: now
      }
    ]
  },
  prSlicesByTask: {
    [TASK_ID]: [
      {
        id: "slice-1",
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        taskId: TASK_ID,
        pullRequestId: "pr-1",
        sliceOrder: 1,
        title: "Web control-plane updates",
        description: "Onboarding + task drilldowns",
        filePaths: ["apps/web-console/app/onboarding/page.tsx", "apps/web-console/app/tasks/page.tsx"],
        riskLevel: "medium",
        status: "open",
        createdAt: now,
        updatedAt: now,
        pullRequest: {
          id: "pr-1",
          number: 42,
          status: "open",
          url: "https://github.com/branchline/console-mvp/pull/42",
          branch: {
            id: BRANCH_ID,
            name: "task/mvp-operator-flow",
            status: "active"
          }
        }
      }
    ]
  },
  reviewDigestByTask: {
    [TASK_ID]: {
      taskId: TASK_ID,
      generatedAt: now,
      digestHash: "digest-42",
      riskLevel: "medium",
      reasonCodes: ["dense_change_overlap", "file_overlap", "symbol_overlap"],
      recommendedAction: "prioritize_conflict_and_quality_review",
      summary: {
        intentEvents: 6,
        activityEvents: 12,
        openConflicts: 1,
        unresolvedHandoffs: 1,
        pullRequestCount: 1,
        prSliceCount: 1,
        latestQualityStatus: "passed",
        failedCheckCount: 0,
        missingRequiredChecks: 0
      },
      sources: {
        intent: {
          firstEventAt: now,
          lastEventAt: now
        },
        activity: {
          firstSeenAt: now,
          lastSeenAt: now
        },
        quality: {
          latestRunId: RUN_ID,
          latestStatus: "passed",
          failedChecks: [],
          requiredChecks: ["build", "unit_tests", "lint"],
          missingRequiredChecks: []
        },
        handoff: {
          count: 1,
          unresolvedCount: 1
        },
        conflicts: {
          count: 1,
          criticalCount: 0,
          highCount: 1
        }
      },
      pullRequests: [
        {
          id: "pr-1",
          number: 42,
          status: "open",
          url: "https://github.com/branchline/console-mvp/pull/42",
          branchName: "task/mvp-operator-flow"
        }
      ],
      slices: [
        {
          id: "slice-1",
          pullRequestId: "pr-1",
          pullRequestNumber: 42,
          pullRequestStatus: "open",
          branchName: "task/mvp-operator-flow",
          sliceOrder: 1,
          title: "Web control-plane updates",
          description: "Onboarding + task drilldowns",
          riskLevel: "medium",
          status: "open",
          filePaths: ["apps/web-console/app/onboarding/page.tsx", "apps/web-console/app/tasks/page.tsx"],
          createdAt: now
        }
      ]
    }
  },
  branchAutomationByBranchId: {
    [BRANCH_ID]: {
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      branchId: BRANCH_ID,
      branchName: "task/mvp-operator-flow",
      repositoryId: REPOSITORY_ID,
      repositoryProvider: "github",
      policy: {
        baseBranch: "main",
        protectedBranches: ["main", "release"],
        autoPush: true,
        autoPr: true,
        staleThresholdMinutes: 120,
        cleanupAfterMergeHours: 24,
        requiredQualityChecks: ["build", "unit_tests", "lint"],
        enforceGuardrailRecheckOnPromote: true
      },
      pullRequest: {
        id: "pr-1",
        number: 42,
        status: "open",
        isDraft: false,
        mergeableState: "clean"
      },
      blockingReasons: [],
      requiredQualityChecks: ["build", "unit_tests", "lint"],
      missingRequiredChecks: []
    }
  },
  qualityRuns: [
    {
      id: RUN_ID,
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      branchId: BRANCH_ID,
      triggerSource: "manual",
      status: "passed",
      createdAt: now,
      checks: [
        {
          id: "check-1",
          checkKey: "build",
          status: "passed",
          durationMs: 45200
        },
        {
          id: "check-2",
          checkKey: "unit_tests",
          status: "passed",
          durationMs: 36800
        },
        {
          id: "check-3",
          checkKey: "lint",
          status: "passed",
          durationMs: 12100
        }
      ]
    }
  ],
  qualityArtifactsByRun: {
    [RUN_ID]: [
      {
        id: "artifact-1",
        runId: RUN_ID,
        checkId: "check-1",
        checkKey: "build",
        checkStatus: "passed",
        artifactType: "build-log",
        storageProvider: "s3",
        storageKey: "quality/build-log.txt",
        contentType: "text/plain",
        sizeBytes: 12400,
        retentionClass: "default",
        metadata: {
          sha: "abc123"
        },
        createdAt: now
      },
      {
        id: "artifact-2",
        runId: RUN_ID,
        checkId: "check-2",
        checkKey: "unit_tests",
        checkStatus: "passed",
        artifactType: "junit",
        storageProvider: "s3",
        storageKey: "quality/junit.xml",
        contentType: "application/xml",
        sizeBytes: 6400,
        retentionClass: "default",
        metadata: {
          tests: 128
        },
        createdAt: now
      }
    ]
  },
  replayByTask: {
    [TASK_ID]: {
      taskId: TASK_ID,
      snapshotVersion: 5,
      generatedAt: now,
      steps: ["intent.created", "branch.created", "quality.run.passed", "handoff.created"]
    }
  },
  provenanceByTask: {
    [TASK_ID]: {
      taskId: TASK_ID,
      generatedAt: now,
      counts: {
        nodes: 6,
        edges: 5,
        intentEvents: 1,
        decisions: 1,
        aiRuns: 1,
        qualityRuns: 1,
        handoffs: 1,
        conflicts: 1
      },
      nodes: [
        { id: "n1", type: "intent", label: "intent.created", timestamp: now },
        { id: "n2", type: "branch", label: "branch.created", timestamp: now },
        { id: "n3", type: "quality", label: "quality.run", timestamp: now },
        { id: "n4", type: "handoff", label: "handoff.created", timestamp: now },
        { id: "n5", type: "conflict", label: "conflict.detected", timestamp: now },
        { id: "n6", type: "decision", label: "promote.decision", timestamp: now }
      ],
      edges: [
        { from: "n1", to: "n2", type: "causes" },
        { from: "n2", to: "n3", type: "triggers" },
        { from: "n3", to: "n4", type: "enables" },
        { from: "n2", to: "n5", type: "conflicts_with" },
        { from: "n4", to: "n6", type: "informs" }
      ]
    }
  },
  presenceByProject: {
    [PROJECT_ID]: [
      {
        id: "presence-1",
        projectId: PROJECT_ID,
        userId: "user-owner",
        state: "active",
        activeFilePath: "apps/web-console/app/tasks/page.tsx",
        lastSeenAt: now
      }
    ]
  },
  pivotReportsByProject: {
    [PROJECT_ID]: [
      {
        id: "report-1",
        title: "Policy delta stale context",
        description: "Policy v3 invalidated existing assumptions",
        effectiveAt: now,
        createdAt: now,
        staleReports: [
          {
            id: "stale-1",
            entityType: "task",
            entityId: TASK_ID,
            reason: "policy_version_changed",
            status: "open"
          }
        ]
      }
    ]
  },
  integrationConnections: [
    {
      id: CONNECTION_ID,
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      provider: "slack",
      authType: "oauth",
      status: "connected",
      credentialVersion: 2,
      lastHealthStatus: "healthy",
      lastHealthCheckedAt: now,
      tokenExpiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: now
    }
  ],
  integrationStatusById: {
    [CONNECTION_ID]: {
      id: CONNECTION_ID,
      provider: "slack",
      status: "connected",
      healthy: true,
      requiresReauth: false,
      tokenExpiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      lastHealthStatus: "healthy",
      lastErrorCode: null,
      lastErrorMessage: null,
      checkedAt: now
    }
  },
  knowledgeDocsByProject: {
    [PROJECT_ID]: [
      {
        id: "aaaa1111-aaaa-1111-aaaa-111111111111",
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        type: "brief",
        slug: "project-brief",
        title: "Project Brief",
        status: "active",
        activeVersion: 1,
        createdBy: "user-owner",
        createdAt: now,
        updatedAt: now,
        versions: [
          {
            id: "ver-brief-1",
            version: 1,
            contentMarkdown: "Ship Branchline MVP with policy and review workflows.",
            mermaidSource: null,
            changeSummary: "Initial brief",
            approvalStatus: "approved",
            proposedBy: "user-owner",
            proposedByType: "user",
            approvedBy: "user-owner",
            approvedAt: now,
            sourceTaskId: null,
            sourceAiRunId: null,
            baseVersion: 0,
            createdAt: now
          }
        ]
      },
      {
        id: "bbbb2222-bbbb-2222-bbbb-222222222222",
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        type: "module_diagram",
        slug: "task-workflow-module",
        title: "Task Workflow Module",
        status: "active",
        activeVersion: 1,
        createdBy: "user-owner",
        createdAt: now,
        updatedAt: now,
        versions: [
          {
            id: "ver-module-1",
            version: 1,
            contentMarkdown: "Task state flow for reviewers",
            mermaidSource: "flowchart TD\\n  A[Task Start] --> B[Branch Ready]\\n  B --> C[Quality]\\n  C --> D[Review]",
            changeSummary: "Initial module diagram",
            approvalStatus: "approved",
            proposedBy: "user-owner",
            proposedByType: "user",
            approvedBy: "user-owner",
            approvedAt: now,
            sourceTaskId: null,
            sourceAiRunId: null,
            baseVersion: 0,
            createdAt: now
          }
        ]
      }
    ]
  },
  phasesByProject: {
    [PROJECT_ID]: [
      {
        id: "cccc3333-cccc-3333-cccc-333333333333",
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        key: "phase-0",
        name: "Foundations",
        objective: "Complete onboarding and policy setup",
        status: "in_progress",
        ownerUserId: "user-owner",
        orderIndex: 0,
        plannedStartAt: now,
        plannedEndAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        revisions: [
          {
            id: "phase-rev-1",
            revision: 1,
            payload: {
              name: "Foundations",
              objective: "Complete onboarding and policy setup",
              status: "in_progress",
              ownerUserId: "user-owner",
              orderIndex: 0,
              plannedStartAt: now,
              plannedEndAt: null,
              completedAt: null
            },
            approvalStatus: "approved",
            proposedBy: "user-owner",
            proposedByType: "user",
            approvedBy: "user-owner",
            approvedAt: now,
            sourceTaskId: null,
            sourceAiRunId: null,
            baseRevision: 0,
            createdAt: now
          }
        ]
      }
    ]
  },
  promptTemplates: [
    {
      id: "prompt-1",
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      name: "Code Review",
      slug: "code-review",
      category: "review",
      isActive: true,
      versions: [{ id: "prompt-v1", version: 1, createdAt: now }]
    }
  ],
  promptUsage: {
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    sinceDays: 30,
    totalUsage: 12,
    templates: [
      {
        templateId: "prompt-1",
        name: "Code Review",
        slug: "code-review",
        usageCount: 12,
        averageRating: 4.5,
        versions: {
          "1": 12
        }
      }
    ]
  }
};

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, {
    "content-type": "application/json"
  });
  res.end(JSON.stringify(payload));
}

function parseJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function rejectIfUnauthorized(req, res) {
  const authHeader = req.headers.authorization ?? "";
  if (authHeader !== `Bearer ${expectedBearerToken}`) {
    sendJson(res, { error: "unauthorized" }, 401);
    return true;
  }
  return false;
}

function qualityRunDetails(run) {
  const artifacts = state.qualityArtifactsByRun[run.id] ?? [];
  const checksSummary = run.checks.reduce(
    (acc, check) => {
      if (check.status === "passed") {
        acc.passed += 1;
      } else if (check.status === "failed") {
        acc.failed += 1;
      } else if (check.status === "canceled") {
        acc.canceled += 1;
      } else if (check.status === "running") {
        acc.running += 1;
      } else {
        acc.queued += 1;
      }
      return acc;
    },
    { queued: 0, running: 0, passed: 0, failed: 0, canceled: 0 }
  );

  return {
    ...run,
    artifactCount: artifacts.length,
    checksSummary
  };
}

function getKnowledgeDocs(projectId) {
  if (!state.knowledgeDocsByProject[projectId]) {
    state.knowledgeDocsByProject[projectId] = [];
  }
  return state.knowledgeDocsByProject[projectId];
}

function getProjectPhases(projectId) {
  if (!state.phasesByProject[projectId]) {
    state.phasesByProject[projectId] = [];
  }
  return state.phasesByProject[projectId];
}

function latestApprovedVersion(doc) {
  return doc.activeVersion ?? 0;
}

function latestApprovedRevision(phase) {
  return phase.revisions
    .filter((revision) => revision.approvalStatus === "approved")
    .reduce((max, revision) => Math.max(max, revision.revision), 0);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    if (!pathname.startsWith("/v1/")) {
      sendJson(res, { error: "not_found" }, 404);
      return;
    }

    if (rejectIfUnauthorized(req, res)) {
      return;
    }

    if (method === "GET" && pathname === "/v1/orgs") {
      sendJson(res, state.organizations);
      return;
    }

    if (method === "POST" && pathname === "/v1/orgs") {
      const body = await parseJson(req);
      const name = String(body.name ?? "").trim();
      const slug = String(body.slug ?? "").trim().toLowerCase();
      if (!name || !slug) {
        sendJson(res, { message: "name and slug are required" }, 400);
        return;
      }
      if (state.organizations.some((entry) => entry.slug === slug)) {
        sendJson(res, { message: "organization slug already exists" }, 409);
        return;
      }

      const id = randomUUID();
      const organization = {
        id,
        name,
        slug,
        role: "owner"
      };
      state.organizations.push(organization);
      state.projectsByOrg[id] = [];
      sendJson(
        res,
        {
          id,
          name,
          slug,
          createdAt: new Date().toISOString()
        },
        201
      );
      return;
    }

    const projectsMatch = pathname.match(/^\/v1\/projects\/([^/]+)$/);
    if (method === "GET" && projectsMatch) {
      const orgId = projectsMatch[1];
      sendJson(res, state.projectsByOrg[orgId] ?? []);
      return;
    }

    if (method === "POST" && pathname === "/v1/projects") {
      const body = await parseJson(req);
      const orgId = String(body.orgId ?? "");
      const name = String(body.name ?? "").trim();
      const key = String(body.key ?? "").trim().toUpperCase();
      const baseBranch = String(body.baseBranch ?? "main").trim() || "main";

      if (!orgId || !name || !key) {
        sendJson(res, { message: "orgId, name, and key are required" }, 400);
        return;
      }
      const orgExists = state.organizations.some((entry) => entry.id === orgId);
      if (!orgExists) {
        sendJson(res, { message: "organization not found" }, 404);
        return;
      }

      const existingInOrg = state.projectsByOrg[orgId] ?? [];
      if (existingInOrg.some((entry) => entry.key === key)) {
        sendJson(res, { message: "project key already exists in org" }, 409);
        return;
      }

      const project = {
        id: randomUUID(),
        orgId,
        name,
        key,
        defaultBaseBranch: baseBranch
      };
      existingInOrg.push(project);
      state.projectsByOrg[orgId] = existingInOrg;
      state.projectMembersByProject[project.id] = [];
      state.repositoriesByProject[project.id] = [];

      sendJson(
        res,
        {
          ...project,
          createdAt: new Date().toISOString()
        },
        201
      );
      return;
    }

    const policyMatch = pathname.match(/^\/v1\/projects\/([^/]+)\/policy$/);
    if (method === "GET" && policyMatch) {
      sendJson(res, state.projectPolicy);
      return;
    }
    if (method === "PUT" && policyMatch) {
      const body = await parseJson(req);
      state.projectPolicy = {
        ...state.projectPolicy,
        ...body
      };
      sendJson(res, state.projectPolicy);
      return;
    }

    const knowledgeOverviewMatch = pathname.match(/^\/v1\/projects\/([^/]+)\/knowledge\/overview$/);
    if (method === "GET" && knowledgeOverviewMatch) {
      const projectId = knowledgeOverviewMatch[1];
      const project =
        Object.values(state.projectsByOrg)
          .flat()
          .find((entry) => entry.id === projectId) ?? null;
      if (!project) {
        sendJson(res, { message: "project not found" }, 404);
        return;
      }
      const docs = getKnowledgeDocs(projectId);
      const phases = getProjectPhases(projectId);

      const briefDoc = docs.find((doc) => doc.type === "brief" && doc.activeVersion !== null);
      const architectureDoc = docs.find(
        (doc) => doc.type === "architecture_notes" && doc.activeVersion !== null
      );
      const briefVersion = briefDoc?.versions.find((version) => version.version === briefDoc.activeVersion) ?? null;
      const architectureVersion =
        architectureDoc?.versions.find((version) => version.version === architectureDoc.activeVersion) ?? null;

      const phaseSummary = phases.reduce(
        (acc, phase) => {
          acc.total += 1;
          if (phase.status === "planned") {
            acc.planned += 1;
          } else if (phase.status === "in_progress") {
            acc.inProgress += 1;
          } else if (phase.status === "blocked") {
            acc.blocked += 1;
          } else if (phase.status === "completed") {
            acc.completed += 1;
          } else {
            acc.archived += 1;
          }
          return acc;
        },
        {
          total: 0,
          planned: 0,
          inProgress: 0,
          blocked: 0,
          completed: 0,
          archived: 0
        }
      );

      const pendingDocs = docs.reduce(
        (count, doc) => count + doc.versions.filter((version) => version.approvalStatus === "draft").length,
        0
      );
      const pendingPhases = phases.reduce(
        (count, phase) => count + phase.revisions.filter((revision) => revision.approvalStatus === "draft").length,
        0
      );

      sendJson(res, {
        project: {
          ...project,
          description: null,
          createdAt: now,
          updatedAt: now
        },
        brief: briefVersion
          ? {
              source: "knowledge_doc",
              docId: briefDoc.id,
              title: briefDoc.title,
              version: briefVersion.version,
              contentMarkdown: briefVersion.contentMarkdown
            }
          : null,
        architectureNotes: architectureVersion
          ? {
              docId: architectureDoc.id,
              title: architectureDoc.title,
              version: architectureVersion.version,
              contentMarkdown: architectureVersion.contentMarkdown
            }
          : null,
        diagrams: {
          moduleCount: docs.filter((doc) => doc.type === "module_diagram").length,
          flowCount: docs.filter((doc) => doc.type === "flow_diagram").length
        },
        phaseSummary,
        pendingApprovals: {
          docs: pendingDocs,
          phases: pendingPhases
        }
      });
      return;
    }

    const knowledgeDocsMatch = pathname.match(/^\/v1\/projects\/([^/]+)\/knowledge\/docs$/);
    if (method === "GET" && knowledgeDocsMatch) {
      const projectId = knowledgeDocsMatch[1];
      sendJson(res, getKnowledgeDocs(projectId));
      return;
    }

    if (method === "POST" && knowledgeDocsMatch) {
      const projectId = knowledgeDocsMatch[1];
      const body = await parseJson(req);
      const docs = getKnowledgeDocs(projectId);
      const createdAt = new Date().toISOString();
      const docId = randomUUID();
      const type = body.type ?? "brief";
      const doc = {
        id: docId,
        orgId: ORG_ID,
        projectId,
        type,
        slug: body.slug ?? String(body.title ?? "doc").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        title: body.title ?? "Untitled Doc",
        status: "active",
        activeVersion: null,
        createdBy: "user-owner",
        createdAt,
        updatedAt: createdAt,
        versions: []
      };
      const version = {
        id: randomUUID(),
        version: 1,
        contentMarkdown: body.contentMarkdown ?? null,
        mermaidSource: body.mermaidSource ?? null,
        changeSummary: body.changeSummary ?? null,
        approvalStatus: "draft",
        proposedBy: "user-owner",
        proposedByType: body.proposedByType ?? "user",
        approvedBy: null,
        approvedAt: null,
        sourceTaskId: body.sourceTaskId ?? null,
        sourceAiRunId: body.sourceAiRunId ?? null,
        baseVersion: doc.activeVersion,
        createdAt
      };
      doc.versions.push(version);
      docs.push(doc);
      sendJson(res, { doc: { ...doc, versions: undefined }, version }, 201);
      return;
    }

    const knowledgeDocVersionsMatch = pathname.match(
      /^\/v1\/projects\/([^/]+)\/knowledge\/docs\/([^/]+)\/versions$/
    );
    if (method === "GET" && knowledgeDocVersionsMatch) {
      const projectId = knowledgeDocVersionsMatch[1];
      const docId = knowledgeDocVersionsMatch[2];
      const doc = getKnowledgeDocs(projectId).find((entry) => entry.id === docId);
      if (!doc) {
        sendJson(res, { message: "Knowledge doc not found" }, 404);
        return;
      }
      sendJson(res, {
        docId: doc.id,
        activeVersion: doc.activeVersion,
        status: doc.status,
        versions: doc.versions
      });
      return;
    }

    if (method === "POST" && knowledgeDocVersionsMatch) {
      const projectId = knowledgeDocVersionsMatch[1];
      const docId = knowledgeDocVersionsMatch[2];
      const body = await parseJson(req);
      const doc = getKnowledgeDocs(projectId).find((entry) => entry.id === docId);
      if (!doc) {
        sendJson(res, { message: "Knowledge doc not found" }, 404);
        return;
      }
      const latestApproved = latestApprovedVersion(doc);
      if (typeof body.baseVersion === "number" && body.baseVersion !== latestApproved) {
        sendJson(res, {
          created: false,
          reason: "version_conflict",
          docId: doc.id,
          latestApprovedVersion: latestApproved
        });
        return;
      }
      const nextVersion = doc.versions.reduce((max, version) => Math.max(max, version.version), 0) + 1;
      const createdAt = new Date().toISOString();
      const version = {
        id: randomUUID(),
        version: nextVersion,
        contentMarkdown: body.contentMarkdown ?? null,
        mermaidSource: body.mermaidSource ?? null,
        changeSummary: body.changeSummary ?? null,
        approvalStatus: "draft",
        proposedBy: "user-owner",
        proposedByType: body.proposedByType ?? "user",
        approvedBy: null,
        approvedAt: null,
        sourceTaskId: body.sourceTaskId ?? null,
        sourceAiRunId: body.sourceAiRunId ?? null,
        baseVersion: body.baseVersion ?? doc.activeVersion ?? 0,
        createdAt
      };
      doc.versions.unshift(version);
      doc.updatedAt = createdAt;
      sendJson(res, {
        created: true,
        docId: doc.id,
        activeVersion: doc.activeVersion,
        version
      });
      return;
    }

    const knowledgeDocApproveMatch = pathname.match(
      /^\/v1\/projects\/([^/]+)\/knowledge\/docs\/([^/]+)\/versions\/([0-9]+)\/approve$/
    );
    if (method === "POST" && knowledgeDocApproveMatch) {
      const projectId = knowledgeDocApproveMatch[1];
      const docId = knowledgeDocApproveMatch[2];
      const versionNumber = Number(knowledgeDocApproveMatch[3]);
      const body = await parseJson(req);
      const doc = getKnowledgeDocs(projectId).find((entry) => entry.id === docId);
      if (!doc) {
        sendJson(res, { message: "Knowledge doc not found" }, 404);
        return;
      }
      const version = doc.versions.find((entry) => entry.version === versionNumber);
      if (!version) {
        sendJson(res, { message: "Knowledge doc version not found" }, 404);
        return;
      }
      if (version.approvalStatus !== "draft") {
        sendJson(res, {
          approved: false,
          reason: "version_not_pending",
          docId: doc.id,
          version: version.version,
          status: version.approvalStatus
        });
        return;
      }
      const latestApproved = latestApprovedVersion(doc);
      if (
        (typeof body.expectedBaseVersion === "number" && body.expectedBaseVersion !== latestApproved) ||
        (typeof version.baseVersion === "number" && version.baseVersion !== latestApproved)
      ) {
        sendJson(res, {
          approved: false,
          reason: "version_conflict",
          docId: doc.id,
          version: version.version,
          latestApprovedVersion: latestApproved
        });
        return;
      }
      for (const entry of doc.versions) {
        if (entry.approvalStatus === "approved") {
          entry.approvalStatus = "superseded";
        }
      }
      const approvedAt = new Date().toISOString();
      version.approvalStatus = "approved";
      version.approvedBy = "user-owner";
      version.approvedAt = approvedAt;
      doc.activeVersion = version.version;
      doc.updatedAt = approvedAt;
      sendJson(res, {
        approved: true,
        docId: doc.id,
        version: version.version,
        activeVersion: version.version,
        approvedAt
      });
      return;
    }

    const knowledgeDocRejectMatch = pathname.match(
      /^\/v1\/projects\/([^/]+)\/knowledge\/docs\/([^/]+)\/versions\/([0-9]+)\/reject$/
    );
    if (method === "POST" && knowledgeDocRejectMatch) {
      const projectId = knowledgeDocRejectMatch[1];
      const docId = knowledgeDocRejectMatch[2];
      const versionNumber = Number(knowledgeDocRejectMatch[3]);
      const doc = getKnowledgeDocs(projectId).find((entry) => entry.id === docId);
      if (!doc) {
        sendJson(res, { message: "Knowledge doc not found" }, 404);
        return;
      }
      const version = doc.versions.find((entry) => entry.version === versionNumber);
      if (!version) {
        sendJson(res, { message: "Knowledge doc version not found" }, 404);
        return;
      }
      if (version.approvalStatus !== "draft") {
        sendJson(res, {
          rejected: false,
          reason: "version_not_pending",
          docId: doc.id,
          version: version.version,
          status: version.approvalStatus
        });
        return;
      }
      const rejectedAt = new Date().toISOString();
      version.approvalStatus = "rejected";
      version.approvedBy = "user-owner";
      version.approvedAt = rejectedAt;
      doc.updatedAt = rejectedAt;
      sendJson(res, {
        rejected: true,
        docId: doc.id,
        version: version.version,
        rejectedAt
      });
      return;
    }

    const knowledgeDocArchiveMatch = pathname.match(
      /^\/v1\/projects\/([^/]+)\/knowledge\/docs\/([^/]+)\/archive$/
    );
    if (method === "POST" && knowledgeDocArchiveMatch) {
      const projectId = knowledgeDocArchiveMatch[1];
      const docId = knowledgeDocArchiveMatch[2];
      const doc = getKnowledgeDocs(projectId).find((entry) => entry.id === docId);
      if (!doc) {
        sendJson(res, { message: "Knowledge doc not found" }, 404);
        return;
      }
      doc.status = "archived";
      doc.updatedAt = new Date().toISOString();
      sendJson(res, {
        archived: true,
        docId: doc.id,
        status: doc.status
      });
      return;
    }

    const phasesMatch = pathname.match(/^\/v1\/projects\/([^/]+)\/phases$/);
    if (method === "GET" && phasesMatch) {
      const projectId = phasesMatch[1];
      sendJson(res, getProjectPhases(projectId));
      return;
    }

    if (method === "POST" && phasesMatch) {
      const projectId = phasesMatch[1];
      const body = await parseJson(req);
      const phases = getProjectPhases(projectId);
      const maxOrder = phases.reduce((max, phase) => Math.max(max, phase.orderIndex), -1);
      const createdAt = new Date().toISOString();
      const phase = {
        id: randomUUID(),
        orgId: ORG_ID,
        projectId,
        key: body.key,
        name: body.name,
        objective: body.objective ?? null,
        status: body.status ?? "planned",
        ownerUserId: body.ownerUserId ?? null,
        orderIndex: Number.isFinite(body.orderIndex) ? body.orderIndex : maxOrder + 1,
        plannedStartAt: body.plannedStartAt ?? null,
        plannedEndAt: body.plannedEndAt ?? null,
        completedAt: body.completedAt ?? null,
        createdAt,
        updatedAt: createdAt,
        revisions: []
      };
      const revision = {
        id: randomUUID(),
        revision: 1,
        payload: {
          name: phase.name,
          objective: phase.objective,
          status: phase.status,
          ownerUserId: phase.ownerUserId,
          orderIndex: phase.orderIndex,
          plannedStartAt: phase.plannedStartAt,
          plannedEndAt: phase.plannedEndAt,
          completedAt: phase.completedAt
        },
        approvalStatus: "draft",
        proposedBy: "user-owner",
        proposedByType: body.proposedByType ?? "user",
        approvedBy: null,
        approvedAt: null,
        sourceTaskId: body.sourceTaskId ?? null,
        sourceAiRunId: body.sourceAiRunId ?? null,
        baseRevision: 0,
        createdAt
      };
      phase.revisions.push(revision);
      phases.push(phase);
      sendJson(res, { phase: { ...phase, revisions: undefined }, revision }, 201);
      return;
    }

    const phaseRevisionMatch = pathname.match(/^\/v1\/projects\/([^/]+)\/phases\/([^/]+)\/revisions$/);
    if (method === "POST" && phaseRevisionMatch) {
      const projectId = phaseRevisionMatch[1];
      const phaseId = phaseRevisionMatch[2];
      const body = await parseJson(req);
      const phase = getProjectPhases(projectId).find((entry) => entry.id === phaseId);
      if (!phase) {
        sendJson(res, { message: "Project phase not found" }, 404);
        return;
      }
      const latestApproved = latestApprovedRevision(phase);
      if (typeof body.baseRevision === "number" && body.baseRevision !== latestApproved) {
        sendJson(res, {
          created: false,
          reason: "revision_conflict",
          phaseId: phase.id,
          latestApprovedRevision: latestApproved
        });
        return;
      }
      const nextRevision = phase.revisions.reduce((max, revision) => Math.max(max, revision.revision), 0) + 1;
      const createdAt = new Date().toISOString();
      const payload = {
        name: body.name ?? phase.name,
        objective: Object.prototype.hasOwnProperty.call(body, "objective") ? body.objective : phase.objective,
        status: body.status ?? phase.status,
        ownerUserId: Object.prototype.hasOwnProperty.call(body, "ownerUserId")
          ? body.ownerUserId
          : phase.ownerUserId,
        orderIndex: Number.isFinite(body.orderIndex) ? body.orderIndex : phase.orderIndex,
        plannedStartAt: Object.prototype.hasOwnProperty.call(body, "plannedStartAt")
          ? body.plannedStartAt
          : phase.plannedStartAt,
        plannedEndAt: Object.prototype.hasOwnProperty.call(body, "plannedEndAt")
          ? body.plannedEndAt
          : phase.plannedEndAt,
        completedAt: Object.prototype.hasOwnProperty.call(body, "completedAt")
          ? body.completedAt
          : phase.completedAt
      };
      const revision = {
        id: randomUUID(),
        revision: nextRevision,
        payload,
        approvalStatus: "draft",
        proposedBy: "user-owner",
        proposedByType: body.proposedByType ?? "user",
        approvedBy: null,
        approvedAt: null,
        sourceTaskId: body.sourceTaskId ?? null,
        sourceAiRunId: body.sourceAiRunId ?? null,
        baseRevision: body.baseRevision ?? latestApproved,
        createdAt
      };
      phase.revisions.unshift(revision);
      phase.updatedAt = createdAt;
      sendJson(res, {
        created: true,
        phaseId: phase.id,
        latestApprovedRevision: latestApproved,
        revision
      });
      return;
    }

    const phaseApproveMatch = pathname.match(
      /^\/v1\/projects\/([^/]+)\/phases\/([^/]+)\/revisions\/([0-9]+)\/approve$/
    );
    if (method === "POST" && phaseApproveMatch) {
      const projectId = phaseApproveMatch[1];
      const phaseId = phaseApproveMatch[2];
      const revisionNumber = Number(phaseApproveMatch[3]);
      const body = await parseJson(req);
      const phase = getProjectPhases(projectId).find((entry) => entry.id === phaseId);
      if (!phase) {
        sendJson(res, { message: "Project phase not found" }, 404);
        return;
      }
      const revision = phase.revisions.find((entry) => entry.revision === revisionNumber);
      if (!revision) {
        sendJson(res, { message: "Project phase revision not found" }, 404);
        return;
      }
      if (revision.approvalStatus !== "draft") {
        sendJson(res, {
          approved: false,
          reason: "revision_not_pending",
          phaseId: phase.id,
          revision: revision.revision,
          status: revision.approvalStatus
        });
        return;
      }
      const latestApproved = latestApprovedRevision(phase);
      if (
        (typeof body.expectedBaseRevision === "number" && body.expectedBaseRevision !== latestApproved) ||
        (typeof revision.baseRevision === "number" && revision.baseRevision !== latestApproved)
      ) {
        sendJson(res, {
          approved: false,
          reason: "revision_conflict",
          phaseId: phase.id,
          revision: revision.revision,
          latestApprovedRevision: latestApproved
        });
        return;
      }
      for (const entry of phase.revisions) {
        if (entry.approvalStatus === "approved") {
          entry.approvalStatus = "superseded";
        }
      }
      const approvedAt = new Date().toISOString();
      revision.approvalStatus = "approved";
      revision.approvedBy = "user-owner";
      revision.approvedAt = approvedAt;
      phase.name = revision.payload.name;
      phase.objective = revision.payload.objective;
      phase.status = revision.payload.status;
      phase.ownerUserId = revision.payload.ownerUserId;
      phase.orderIndex = revision.payload.orderIndex;
      phase.plannedStartAt = revision.payload.plannedStartAt;
      phase.plannedEndAt = revision.payload.plannedEndAt;
      phase.completedAt = revision.payload.completedAt;
      phase.updatedAt = approvedAt;
      sendJson(res, {
        approved: true,
        phaseId: phase.id,
        revision: revision.revision,
        approvedAt
      });
      return;
    }

    const phasesReorderMatch = pathname.match(/^\/v1\/projects\/([^/]+)\/phases\/reorder$/);
    if (method === "POST" && phasesReorderMatch) {
      const projectId = phasesReorderMatch[1];
      const body = await parseJson(req);
      const phaseIds = Array.isArray(body.phaseIds) ? body.phaseIds : [];
      const phases = getProjectPhases(projectId);
      if (phaseIds.length === 0) {
        sendJson(res, { message: "No phase ids provided for reordering" }, 400);
        return;
      }
      const phaseMap = new Map(phases.map((phase) => [phase.id, phase]));
      if (phaseIds.some((phaseId) => !phaseMap.has(phaseId))) {
        sendJson(res, { message: "One or more phases were not found in this project" }, 404);
        return;
      }
      phaseIds.forEach((phaseId, index) => {
        const phase = phaseMap.get(phaseId);
        phase.orderIndex = index;
      });
      sendJson(res, {
        reordered: true,
        projectId,
        phaseIds
      });
      return;
    }

    if (method === "GET" && pathname === "/v1/memberships/org-members") {
      const orgId = url.searchParams.get("orgId");
      const members = state.orgMembers.filter((member) => member.orgId === orgId);
      sendJson(res, members);
      return;
    }

    if (method === "POST" && pathname === "/v1/memberships/invite") {
      const body = await parseJson(req);
      const inviteId = randomUUID();
      const invite = {
        id: inviteId,
        orgId: body.orgId,
        userId: `invited-${inviteId.slice(0, 8)}`,
        role: body.role ?? "member",
        status: "invited",
        invitedBy: "user-owner",
        inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        acceptedAt: null,
        user: {
          id: `invited-${inviteId.slice(0, 8)}`,
          email: body.email,
          displayName: null
        }
      };
      state.orgMembers.push(invite);
      sendJson(res, {
        inviteId,
        orgId: body.orgId,
        email: body.email,
        role: invite.role,
        status: invite.status,
        inviteExpiresAt: invite.inviteExpiresAt,
        inviteLink: `https://example.com/invite/${inviteId}`
      });
      return;
    }

    if (method === "POST" && pathname === "/v1/memberships/revoke") {
      const body = await parseJson(req);
      const invite = state.orgMembers.find((member) => member.id === body.inviteId);
      if (invite) {
        invite.status = "revoked";
      }
      sendJson(res, {
        id: body.inviteId,
        status: invite?.status ?? "revoked"
      });
      return;
    }

    const updateRoleMatch = pathname.match(/^\/v1\/memberships\/([^/]+)\/role$/);
    if (method === "PATCH" && updateRoleMatch) {
      const membershipId = updateRoleMatch[1];
      const body = await parseJson(req);
      const member = state.orgMembers.find((entry) => entry.id === membershipId);
      if (!member) {
        sendJson(res, { error: "not_found" }, 404);
        return;
      }
      member.role = body.role ?? member.role;
      sendJson(res, member);
      return;
    }

    if (method === "GET" && pathname === "/v1/memberships/project-members") {
      const projectId = url.searchParams.get("projectId");
      sendJson(res, state.projectMembersByProject[projectId] ?? []);
      return;
    }

    if (method === "GET" && pathname === "/v1/repositories") {
      const projectId = url.searchParams.get("projectId");
      sendJson(res, state.repositoriesByProject[projectId] ?? []);
      return;
    }

    if (method === "GET" && pathname === "/v1/github/installations/status") {
      const orgId = url.searchParams.get("orgId");
      const projectId = url.searchParams.get("projectId");
      const repositories = state.repositoriesByProject[projectId] ?? [];
      sendJson(res, {
        orgId,
        projectId: projectId ?? undefined,
        repositoryCount: repositories.length,
        installations: state.githubInstallations,
        repositories: repositories.map((repository) => ({
          id: repository.id,
          fullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          githubInstallationId: state.githubInstallations[0]?.githubInstallationId ?? null
        }))
      });
      return;
    }

    if (method === "POST" && pathname === "/v1/github/reconcile") {
      sendJson(res, {
        scanned: 1,
        reconciled: 1,
        failed: 0,
        skipped: 0
      });
      return;
    }

    if (method === "GET" && pathname === "/v1/guardrails/policies") {
      const projectId = url.searchParams.get("projectId");
      const name = url.searchParams.get("name") ?? "default";
      const includeRules = url.searchParams.get("includeRules") === "true";
      const policies = state.guardrailPolicies
        .filter((entry) => entry.projectId === projectId && entry.name === name)
        .sort((a, b) => b.version - a.version)
        .map((entry) => ({
          ...entry,
          rules: includeRules ? entry.rules : []
        }));
      sendJson(res, policies);
      return;
    }

    if (method === "POST" && pathname === "/v1/guardrails/policies/activate") {
      const body = await parseJson(req);
      const target = state.guardrailPolicies.find(
        (entry) =>
          entry.projectId === body.projectId && entry.name === (body.name ?? "default") && entry.version === body.version
      );
      if (!target) {
        sendJson(res, { error: "not_found" }, 404);
        return;
      }
      for (const entry of state.guardrailPolicies) {
        if (entry.projectId === body.projectId && entry.name === (body.name ?? "default")) {
          entry.status = "inactive";
        }
      }
      target.status = "active";
      sendJson(res, {
        id: target.id,
        projectId: target.projectId,
        name: target.name,
        version: target.version,
        status: target.status
      });
      return;
    }

    if (method === "GET" && pathname === "/v1/tasks") {
      const projectId = url.searchParams.get("projectId");
      const status = url.searchParams.get("status");
      const limit = Number(url.searchParams.get("limit") ?? 100);
      const filtered = state.tasks
        .filter((task) => task.projectId === projectId)
        .filter((task) => (status ? task.status === status : true))
        .slice(0, limit);
      sendJson(res, filtered);
      return;
    }

    const taskMatch = pathname.match(/^\/v1\/tasks\/([^/]+)$/);
    if (method === "GET" && taskMatch) {
      sendJson(res, state.taskDetailsById[taskMatch[1]] ?? null);
      return;
    }

    const taskConflictMatch = pathname.match(/^\/v1\/tasks\/([^/]+)\/conflicts$/);
    if (method === "GET" && taskConflictMatch) {
      sendJson(res, state.conflictsByTask[taskConflictMatch[1]] ?? []);
      return;
    }

    const taskHandoffMatch = pathname.match(/^\/v1\/tasks\/([^/]+)\/handoffs$/);
    if (method === "GET" && taskHandoffMatch) {
      sendJson(res, state.handoffsByTask[taskHandoffMatch[1]] ?? []);
      return;
    }

    const taskSliceMatch = pathname.match(/^\/v1\/tasks\/([^/]+)\/pr-slices$/);
    if (method === "GET" && taskSliceMatch) {
      sendJson(res, state.prSlicesByTask[taskSliceMatch[1]] ?? []);
      return;
    }

    const taskDigestMatch = pathname.match(/^\/v1\/tasks\/([^/]+)\/review-digest$/);
    if (method === "GET" && taskDigestMatch) {
      const digest = state.reviewDigestByTask[taskDigestMatch[1]];
      if (!digest) {
        sendJson(res, { message: "review digest not found" }, 404);
        return;
      }
      sendJson(res, digest);
      return;
    }

    if (method === "POST" && pathname === "/v1/conflicts/claims") {
      const body = await parseJson(req);
      const expiresAt = new Date(Date.now() + (body.ttlMinutes ?? 120) * 60 * 1000).toISOString();
      sendJson(res, {
        id: randomUUID(),
        scopeType: body.scopeType ?? "file",
        scopeValue: body.scopeValue,
        expiresAt
      });
      return;
    }

    const handoffAckMatch = pathname.match(/^\/v1\/handoffs\/([^/]+)\/ack$/);
    if (method === "POST" && handoffAckMatch) {
      const body = await parseJson(req);
      sendJson(res, {
        handoffPacketId: handoffAckMatch[1],
        ackBy: "user-owner",
        notes: body.notes ?? null
      });
      return;
    }

    const branchStatusMatch = pathname.match(/^\/v1\/branches\/([^/]+)\/automation-status$/);
    if (method === "GET" && branchStatusMatch) {
      const branchStatus = state.branchAutomationByBranchId[branchStatusMatch[1]];
      if (!branchStatus) {
        sendJson(res, { error: "not_found" }, 404);
        return;
      }
      sendJson(res, branchStatus);
      return;
    }

    if (method === "GET" && pathname === "/v1/quality-gates") {
      const projectId = url.searchParams.get("projectId");
      const taskId = url.searchParams.get("taskId");
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const runs = state.qualityRuns
        .filter((run) => (projectId ? run.projectId === projectId : true))
        .filter((run) => (taskId ? run.taskId === taskId : true))
        .slice(0, limit);
      sendJson(res, runs);
      return;
    }

    const qualityRunMatch = pathname.match(/^\/v1\/quality-gates\/([^/]+)$/);
    if (method === "GET" && qualityRunMatch) {
      const run = state.qualityRuns.find((entry) => entry.id === qualityRunMatch[1]);
      if (!run) {
        sendJson(res, { error: "not_found" }, 404);
        return;
      }
      sendJson(res, qualityRunDetails(run));
      return;
    }

    const qualityArtifactsMatch = pathname.match(/^\/v1\/quality-gates\/([^/]+)\/artifacts$/);
    if (method === "GET" && qualityArtifactsMatch) {
      const includeMetadata = url.searchParams.get("includeMetadata") === "true";
      const artifacts = (state.qualityArtifactsByRun[qualityArtifactsMatch[1]] ?? []).map((artifact) => ({
        ...artifact,
        metadata: includeMetadata ? artifact.metadata : undefined
      }));
      sendJson(res, artifacts);
      return;
    }

    const replayMatch = pathname.match(/^\/v1\/replay\/([^/]+)$/);
    if (method === "GET" && replayMatch) {
      const replay = state.replayByTask[replayMatch[1]];
      if (!replay) {
        sendJson(res, { error: "not_found" }, 404);
        return;
      }
      sendJson(res, replay);
      return;
    }

    if (method === "GET" && pathname === "/v1/provenance/graph") {
      const taskId = url.searchParams.get("taskId");
      const graph = state.provenanceByTask[taskId];
      if (!graph) {
        sendJson(res, { error: "not_found" }, 404);
        return;
      }
      sendJson(res, graph);
      return;
    }

    if (method === "GET" && pathname === "/v1/activity/presence") {
      const projectId = url.searchParams.get("projectId");
      sendJson(res, state.presenceByProject[projectId] ?? []);
      return;
    }

    if (method === "GET" && pathname === "/v1/pivot/reports") {
      const projectId = url.searchParams.get("projectId");
      const limit = Number(url.searchParams.get("limit") ?? 20);
      sendJson(res, (state.pivotReportsByProject[projectId] ?? []).slice(0, limit));
      return;
    }

    if (method === "GET" && pathname === "/v1/integrations/connections") {
      const orgId = url.searchParams.get("orgId");
      const projectId = url.searchParams.get("projectId");
      const rows = state.integrationConnections.filter(
        (connection) =>
          connection.orgId === orgId && (projectId ? connection.projectId === projectId : true)
      );
      sendJson(res, rows);
      return;
    }

    const integrationStatusMatch = pathname.match(/^\/v1\/integrations\/connections\/([^/]+)\/status$/);
    if (method === "GET" && integrationStatusMatch) {
      const status = state.integrationStatusById[integrationStatusMatch[1]];
      if (!status) {
        sendJson(res, { error: "not_found" }, 404);
        return;
      }
      sendJson(res, status);
      return;
    }

    const integrationHealthMatch = pathname.match(/^\/v1\/integrations\/connections\/([^/]+)\/health$/);
    if (method === "GET" && integrationHealthMatch) {
      const status = state.integrationStatusById[integrationHealthMatch[1]];
      if (!status) {
        sendJson(res, { error: "not_found" }, 404);
        return;
      }
      sendJson(res, {
        id: integrationHealthMatch[1],
        provider: status.provider ?? "unknown",
        healthy: status.healthy ?? false,
        status: status.status,
        checkedAt: status.checkedAt ?? now
      });
      return;
    }

    if (method === "POST" && pathname === "/v1/integrations/oauth/start") {
      const body = await parseJson(req);
      const provider = body.provider ?? "slack";
      sendJson(res, {
        started: true,
        connectionId: CONNECTION_ID,
        provider,
        status: "oauth_pending",
        authorizeUrl: `http://127.0.0.1:${webPort}/integrations?oauth=started&provider=${provider}`,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
      return;
    }

    const integrationReauthMatch = pathname.match(/^\/v1\/integrations\/connections\/([^/]+)\/reauthorize$/);
    if (method === "POST" && integrationReauthMatch) {
      sendJson(res, {
        started: true,
        connectionId: integrationReauthMatch[1],
        provider: "slack",
        status: "reauthorize_pending",
        authorizeUrl: `http://127.0.0.1:${webPort}/integrations?oauth=reauthorize&provider=slack`,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
      return;
    }

    const integrationUnlinkMatch = pathname.match(/^\/v1\/integrations\/connections\/([^/]+)\/unlink$/);
    if (method === "POST" && integrationUnlinkMatch) {
      const connection = state.integrationConnections.find((entry) => entry.id === integrationUnlinkMatch[1]);
      if (connection) {
        connection.status = "unlinked";
      }
      const status = state.integrationStatusById[integrationUnlinkMatch[1]];
      if (status) {
        status.status = "unlinked";
        status.healthy = false;
      }
      sendJson(res, {
        unlinked: true,
        id: integrationUnlinkMatch[1],
        status: "unlinked"
      });
      return;
    }

    if (method === "GET" && pathname === "/v1/prompt-library/templates") {
      sendJson(res, state.promptTemplates);
      return;
    }

    if (method === "GET" && pathname === "/v1/prompt-library/usage") {
      const sinceDaysRaw = Number(url.searchParams.get("sinceDays") ?? state.promptUsage.sinceDays);
      sendJson(res, {
        ...state.promptUsage,
        sinceDays: Number.isFinite(sinceDaysRaw) ? sinceDaysRaw : state.promptUsage.sinceDays
      });
      return;
    }

    if (method === "GET" && pathname === "/v1/audit/export") {
      sendJson(res, {
        generatedAt: now,
        count: 42,
        digest: "audit-digest-1234"
      });
      return;
    }

    if (method === "GET" && pathname === "/v1/audit/verify") {
      sendJson(res, {
        verifiedAt: now,
        checkedRecords: 42,
        valid: true,
        mismatchCount: 0
      });
      return;
    }

    if (method === "GET" && pathname === "/v1/audit/redaction-policy") {
      sendJson(res, {
        orgId: ORG_ID,
        capturePromptText: false,
        captureCodeSnippets: false,
        redactionPatterns: ["password", "api_key", "token"]
      });
      return;
    }

    if (method === "GET" && pathname === "/v1/audit/retention-policy") {
      sendJson(res, {
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        intentEventsDays: 30,
        activityEventsDays: 14,
        qualityArtifactsDays: 30,
        auditLogsDays: 365
      });
      return;
    }

    if (method === "GET" && pathname === "/v1/observability/queues") {
      sendJson(res, {
        at: now,
        queues: [
          {
            name: "queue.quality.run",
            active: 1,
            waiting: 0,
            failed: 0,
            completed: 12,
            delayed: 0
          }
        ]
      });
      return;
    }

    if (method === "GET" && pathname === "/v1/observability/realtime-latency") {
      const projectId = url.searchParams.get("projectId") ?? PROJECT_ID;
      sendJson(res, {
        projectId,
        windowMinutes: Number(url.searchParams.get("windowMinutes") ?? 60),
        sampleCount: 42,
        p50Ms: 280,
        p95Ms: 720,
        maxMs: 1100,
        targetP95Ms: 2000,
        withinTarget: true,
        generatedAt: now
      });
      return;
    }

    sendJson(res, { error: "not_found" }, 404);
  } catch (error) {
    sendJson(
      res,
      {
        error: error instanceof Error ? error.message : "internal_error"
      },
      500
    );
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock Branchline API listening at http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
