import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const read = (prefix) => argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);

  return {
    output: resolve(
      process.cwd(),
      read("--output=") ?? "artifacts/live-e2e/fixtures.json"
    ),
    runId:
      read("--runId=") ??
      `fixtures-${new Date().toISOString().replace(/[.:]/g, "-")}-${randomUUID().slice(0, 8)}`,
    lane: read("--lane=") ?? process.env.BRANCHLINE_CI_LANE ?? "local",
    gitSha: read("--gitSha=") ?? resolveGitSha(),
    apiBaseUrl:
      (read("--apiBaseUrl=") ?? process.env.BRANCHLINE_API_BASE_URL ?? "http://127.0.0.1:4000/v1").replace(
        /\/$/,
        ""
      ),
    orgSlug: process.env.BRANCHLINE_LIVE_ORG_SLUG ?? "branchline-mvp-live",
    orgName: process.env.BRANCHLINE_LIVE_ORG_NAME ?? "Branchline MVP Live",
    projectKey: process.env.BRANCHLINE_LIVE_PROJECT_KEY ?? "MVPLIVE",
    projectName: process.env.BRANCHLINE_LIVE_PROJECT_NAME ?? "Branchline MVP Live Project",
    mainRepoOwner: process.env.BRANCHLINE_LIVE_MAIN_REPO_OWNER ?? "branchline",
    mainRepoName: process.env.BRANCHLINE_LIVE_MAIN_REPO_NAME ?? "live-mvp-main",
    mismatchRepoOwner: process.env.BRANCHLINE_LIVE_MISMATCH_REPO_OWNER ?? "branchline",
    mismatchRepoName: process.env.BRANCHLINE_LIVE_MISMATCH_REPO_NAME ?? "live-mvp-mismatch",
    githubInstallationId: Number(process.env.BRANCHLINE_GITHUB_INSTALLATION_ID ?? 900_001),
    ownerEmail: process.env.BRANCHLINE_LIVE_OWNER_EMAIL ?? "live-owner@branchline.dev",
    extensionEmail: process.env.BRANCHLINE_LIVE_EXTENSION_EMAIL ?? "extension-e2e@branchline.dev",
    adminEmail: process.env.BRANCHLINE_LIVE_ADMIN_EMAIL ?? "live-admin@branchline.dev",
    memberEmail: process.env.BRANCHLINE_LIVE_MEMBER_EMAIL ?? "live-member@branchline.dev",
    viewerEmail: process.env.BRANCHLINE_LIVE_VIEWER_EMAIL ?? "live-viewer@branchline.dev",
    skipTaskSeed: argv.includes("--skip-task-seed")
  };
}

function resolveGitSha() {
  const fromEnv = process.env.GITHUB_SHA?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const result = spawnSync("git rev-parse HEAD", {
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status === 0) {
    const sha = result.stdout.trim();
    if (sha.length > 0) {
      return sha;
    }
  }
  return "unknown";
}

function getErrorText(response, text) {
  if (!text || text.length === 0) {
    return `${response.status} ${response.statusText}`;
  }

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.message === "string" && parsed.message.length > 0) {
      return `${response.status} ${response.statusText}: ${parsed.message}`;
    }
    if (typeof parsed?.error === "string" && parsed.error.length > 0) {
      return `${response.status} ${response.statusText}: ${parsed.error}`;
    }
  } catch {
    // Fall through to raw text.
  }

  return `${response.status} ${response.statusText}: ${text}`;
}

async function requestJson({ apiBaseUrl, path, token, method = "GET", body }) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown network error";
    throw new Error(
      `Unable to reach API at ${apiBaseUrl}. Start api-server first (pnpm --filter @branchline/api-server dev). Details: ${message}`
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${getErrorText(response, text)}`);
  }

  if (!text) {
    return {};
  }

  return JSON.parse(text);
}

async function issueAccessToken(input) {
  const start = await requestJson({
    apiBaseUrl: input.apiBaseUrl,
    path: "/auth/device/start",
    method: "POST",
    body: {
      email: input.email,
      role: input.role
    }
  });

  if (!start?.deviceCode) {
    throw new Error(`Device auth start failed for ${input.email}: missing deviceCode`);
  }

  const exchange = await requestJson({
    apiBaseUrl: input.apiBaseUrl,
    path: "/auth/device/token",
    method: "POST",
    body: {
      deviceCode: start.deviceCode
    }
  });

  if (exchange?.status !== "approved" || typeof exchange?.accessToken !== "string") {
    throw new Error(
      `Device auth exchange failed for ${input.email}: expected approved access token`
    );
  }

  return exchange.accessToken;
}

async function ensureOrganization(config, ownerToken) {
  const organizations = await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: "/orgs",
    token: ownerToken
  });

  const existing = Array.isArray(organizations)
    ? organizations.find((org) => org?.slug === config.orgSlug)
    : undefined;

  if (existing) {
    return existing;
  }

  return requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: "/orgs",
    method: "POST",
    token: ownerToken,
    body: {
      name: config.orgName,
      slug: config.orgSlug
    }
  });
}

async function ensureProject(config, ownerToken, orgId) {
  const projects = await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: `/projects/${orgId}`,
    token: ownerToken
  });

  const existing = Array.isArray(projects)
    ? projects.find((project) => project?.key === config.projectKey)
    : undefined;

  if (existing) {
    return existing;
  }

  return requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: "/projects",
    method: "POST",
    token: ownerToken,
    body: {
      orgId,
      name: config.projectName,
      key: config.projectKey,
      baseBranch: "main"
    }
  });
}

async function ensureRepository(config, ownerToken, input) {
  const repositories = await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: `/repositories?projectId=${input.projectId}`,
    token: ownerToken
  });

  const expectedFullName = `${input.owner}/${input.name}`;
  const existing = Array.isArray(repositories)
    ? repositories.find((repository) => repository?.fullName === expectedFullName)
    : undefined;

  if (existing) {
    return existing;
  }

  return requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: "/repositories/bind",
    method: "POST",
    token: ownerToken,
    body: {
      projectId: input.projectId,
      provider: "github",
      providerRepoId: expectedFullName,
      owner: input.owner,
      name: input.name,
      defaultBranch: "main",
      isPrivate: true
    }
  });
}

async function ensureOrgMember(config, ownerToken, input) {
  const memberToken = await issueAccessToken({
    apiBaseUrl: config.apiBaseUrl,
    email: input.email,
    role: input.role
  });

  const loadMembers = async () =>
    requestJson({
      apiBaseUrl: config.apiBaseUrl,
      path: `/memberships/org-members?orgId=${input.orgId}`,
      token: ownerToken
    });

  let members = await loadMembers();
  let membership = Array.isArray(members)
    ? members.find((entry) => entry?.user?.email?.toLowerCase() === input.email.toLowerCase())
    : undefined;

  if (!membership) {
    const invite = await requestJson({
      apiBaseUrl: config.apiBaseUrl,
      path: "/memberships/invite",
      method: "POST",
      token: ownerToken,
      body: {
        orgId: input.orgId,
        email: input.email,
        role: input.role,
        expiresInDays: 7
      }
    });

    await requestJson({
      apiBaseUrl: config.apiBaseUrl,
      path: "/memberships/accept",
      method: "POST",
      token: memberToken,
      body: {
        inviteId: invite.inviteId
      }
    });

    members = await loadMembers();
    membership = Array.isArray(members)
      ? members.find((entry) => entry?.user?.email?.toLowerCase() === input.email.toLowerCase())
      : undefined;
  }

  if (!membership) {
    throw new Error(`Failed to provision org member for ${input.email}`);
  }

  if (membership.status === "invited") {
    await requestJson({
      apiBaseUrl: config.apiBaseUrl,
      path: "/memberships/accept",
      method: "POST",
      token: memberToken,
      body: {
        inviteId: membership.id
      }
    });

    members = await loadMembers();
    membership = Array.isArray(members)
      ? members.find((entry) => entry?.id === membership.id)
      : membership;
  }

  if (membership.status !== "active") {
    throw new Error(`Org member ${input.email} is not active (status=${membership.status})`);
  }

  if (membership.role !== input.role) {
    await requestJson({
      apiBaseUrl: config.apiBaseUrl,
      path: `/memberships/${membership.id}/role`,
      method: "PATCH",
      token: ownerToken,
      body: {
        role: input.role
      }
    });

    members = await loadMembers();
    membership = Array.isArray(members)
      ? members.find((entry) => entry?.id === membership.id)
      : membership;
  }

  return {
    email: input.email,
    role: input.role,
    bearerToken: memberToken,
    membershipId: membership.id
  };
}

async function seedPilotTask(config, ownerToken, scope) {
  const task = await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: "/tasks/start",
    method: "POST",
    token: ownerToken,
    body: {
      orgId: scope.orgId,
      projectId: scope.projectId,
      repositoryId: scope.repositoryId,
      title: `Live MVP Seed Task ${Date.now()}`
    }
  });

  const branchResponse = await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: "/branches/create",
    method: "POST",
    token: ownerToken,
    body: {
      projectId: scope.projectId,
      taskId: task.id,
      ticketOrTask: task.id,
      taskSlug: "live-mvp-seed-task",
      currentBranch: "source-work"
    }
  });

  const branchId = branchResponse?.branch?.id;

  if (branchId) {
    await requestJson({
      apiBaseUrl: config.apiBaseUrl,
      path: `/branches/${branchId}/ensure-pr`,
      method: "POST",
      token: ownerToken,
      body: {
        title: `Live MVP Seed Task ${Date.now()}`,
        draft: true
      }
    }).catch(() => ({}));
  }

  await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: "/intent/events",
    method: "POST",
    token: ownerToken,
    body: {
      eventId: randomUUID(),
      orgId: scope.orgId,
      projectId: scope.projectId,
      source: "extension",
      type: "intent.task_started",
      timestamp: new Date().toISOString(),
      actor: {
        userId: undefined,
        clientId: undefined
      },
      context: {
        taskId: task.id,
        branchId,
        repositoryId: scope.repositoryId
      },
      payload: {
        title: task.title
      },
      sequence: 1
    }
  });

  await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: "/activity/presence",
    method: "POST",
    token: ownerToken,
    body: {
      orgId: scope.orgId,
      projectId: scope.projectId,
      taskId: task.id,
      branchId,
      repositoryId: scope.repositoryId,
      state: "editing",
      activeFilePath: "apps/web-console/app/tasks/page.tsx",
      activeSymbol: "TasksPage"
    }
  });

  await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: "/conflicts/score",
    method: "POST",
    token: ownerToken,
    body: {
      orgId: scope.orgId,
      projectId: scope.projectId,
      repositoryId: scope.repositoryId,
      taskId: task.id,
      overlappingFiles: ["apps/web-console/app/tasks/page.tsx"],
      overlappingSymbols: ["TasksPage"],
      guardrailBoundaryOverlap: 35,
      overlapDensity: 50,
      branchDivergenceCommits: 3,
      staleMinutes: 30,
      ownershipClaimsActive: 1
    }
  });

  await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: `/tasks/${task.id}/handoff`,
    method: "POST",
    token: ownerToken,
    body: {}
  });

  const qualityRun = await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: "/quality-gates/run",
    method: "POST",
    token: ownerToken,
    body: {
      taskId: task.id,
      triggerSource: "live_seed"
    }
  }).catch(() => null);

  await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: `/replay/${task.id}`,
    token: ownerToken
  }).catch(() => ({}));

  await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: `/provenance/graph?taskId=${task.id}`,
    token: ownerToken
  }).catch(() => ({}));

  return {
    id: task.id,
    title: task.title,
    branchId,
    qualityRunId: qualityRun?.id
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));

  const ownerToken = await issueAccessToken({
    apiBaseUrl: config.apiBaseUrl,
    email: config.ownerEmail,
    role: "owner"
  });

  const organization = await ensureOrganization(config, ownerToken);
  const project = await ensureProject(config, ownerToken, organization.id);

  const mainRepository = await ensureRepository(config, ownerToken, {
    projectId: project.id,
    owner: config.mainRepoOwner,
    name: config.mainRepoName
  });
  const mismatchRepository = await ensureRepository(config, ownerToken, {
    projectId: project.id,
    owner: config.mismatchRepoOwner,
    name: config.mismatchRepoName
  });

  await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: "/github/installations/sync",
    method: "POST",
    token: ownerToken,
    body: {
      orgId: organization.id,
      projectId: project.id,
      githubInstallationId: config.githubInstallationId,
      accountLogin: config.mainRepoOwner,
      accountType: "Organization",
      repositories: [
        {
          providerRepoId: `${config.mainRepoOwner}/${config.mainRepoName}`,
          owner: config.mainRepoOwner,
          name: config.mainRepoName,
          defaultBranch: "main",
          isPrivate: true,
          metadata: {
            source: "seed-live-e2e"
          },
          projectId: project.id
        }
      ]
    }
  });

  await requestJson({
    apiBaseUrl: config.apiBaseUrl,
    path: "/guardrails/policies",
    method: "POST",
    token: ownerToken,
    body: {
      orgId: organization.id,
      projectId: project.id,
      name: "default",
      activate: true,
      config: {
        maxChangedFiles: 50
      },
      rules: [
        {
          ruleKey: "extension-pre-apply-src-block",
          ruleType: "path_prefix_block",
          severity: "fail",
          expression: {
            prefix: "src/"
          },
          enabled: true
        },
        {
          ruleKey: "require-app-prefix",
          ruleType: "path_prefix_require",
          severity: "warn",
          expression: {
            prefix: "apps/"
          },
          enabled: true
        }
      ]
    }
  });

  const extensionUser = await ensureOrgMember(config, ownerToken, {
    orgId: organization.id,
    email: config.extensionEmail,
    role: "member"
  });
  const adminUser = await ensureOrgMember(config, ownerToken, {
    orgId: organization.id,
    email: config.adminEmail,
    role: "admin"
  });
  const memberUser = await ensureOrgMember(config, ownerToken, {
    orgId: organization.id,
    email: config.memberEmail,
    role: "member"
  });
  const viewerUser = await ensureOrgMember(config, ownerToken, {
    orgId: organization.id,
    email: config.viewerEmail,
    role: "viewer"
  });

  const seededTask = config.skipTaskSeed
    ? null
    : await seedPilotTask(config, ownerToken, {
        orgId: organization.id,
        projectId: project.id,
        repositoryId: mainRepository.id
      });

  const output = {
    schemaVersion: "1.0.0",
    runId: config.runId,
    lane: config.lane,
    gitSha: config.gitSha,
    generatedAt: new Date().toISOString(),
    apiBaseUrl: config.apiBaseUrl,
    org: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug
    },
    project: {
      id: project.id,
      key: project.key,
      name: project.name
    },
    repositories: {
      main: {
        id: mainRepository.id,
        fullName: `${config.mainRepoOwner}/${config.mainRepoName}`
      },
      mismatch: {
        id: mismatchRepository.id,
        fullName: `${config.mismatchRepoOwner}/${config.mismatchRepoName}`
      }
    },
    github: {
      installationId: config.githubInstallationId,
      accountLogin: config.mainRepoOwner
    },
    users: {
      owner: {
        email: config.ownerEmail,
        role: "owner",
        bearerToken: ownerToken
      },
      extension: extensionUser,
      admin: adminUser,
      member: memberUser,
      viewer: viewerUser
    },
    seededTask
  };

  mkdirSync(dirname(config.output), { recursive: true });
  writeFileSync(config.output, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`[seed-live-e2e] wrote fixtures: ${config.output}`);
  console.log(`[seed-live-e2e] org=${organization.id} project=${project.id} repo=${mainRepository.id}`);
}

main().catch((error) => {
  console.error("[seed-live-e2e] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
