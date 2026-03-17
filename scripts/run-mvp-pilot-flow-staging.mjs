import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const read = (prefix) => argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);

  return {
    fixturesPath: resolve(
      process.cwd(),
      read("--fixtures=") ?? process.env.BRANCHLINE_LIVE_FIXTURES ?? "artifacts/live-e2e/fixtures.json"
    ),
    outputPath: resolve(
      process.cwd(),
      read("--output=") ?? "artifacts/mvp-gate/pilot-flow.json"
    ),
    qualityTimeoutMs: Number(read("--qualityTimeoutMs=") ?? 90_000),
    lane: read("--lane=") ?? process.env.BRANCHLINE_CI_LANE ?? "local",
    runId: read("--runId=") ?? `pilot-${randomUUID()}`,
    gitSha: read("--gitSha=") ?? resolveGitSha()
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

function fail(message) {
  throw new Error(message);
}

async function requestJson({ baseUrl, token, path, method = "GET", body }) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

async function waitForQualityTerminal(input) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < input.timeoutMs) {
    const run = await requestJson({
      baseUrl: input.baseUrl,
      token: input.token,
      path: `/quality-gates/${input.runId}`
    });

    if (["passed", "failed", "canceled"].includes(run?.status)) {
      return run;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
  }

  fail(`quality run did not reach terminal state within ${input.timeoutMs}ms`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = JSON.parse(readFileSync(args.fixturesPath, "utf8"));

  const ownerToken = fixtures?.users?.owner?.bearerToken;
  const extensionToken = fixtures?.users?.extension?.bearerToken;
  const apiBaseUrl = fixtures?.apiBaseUrl;
  const orgId = fixtures?.org?.id;
  const projectId = fixtures?.project?.id;
  const repositoryId = fixtures?.repositories?.main?.id;

  if (!ownerToken || !extensionToken || !apiBaseUrl || !orgId || !projectId || !repositoryId) {
    fail("fixtures are missing required owner/extension/apiBaseUrl/org/project/repository fields");
  }

  const runId = args.runId;
  const steps = [];
  let taskId;
  let branchId;
  let handoffId;

  const step = async (id, execute) => {
    const startedAt = new Date();

    try {
      const evidence = await execute();
      steps.push({
        id,
        status: "passed",
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        evidence
      });
      return evidence;
    } catch (error) {
      steps.push({
        id,
        status: "failed",
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  };

  await step("onboarding_scope", async () => {
    const [orgs, projects] = await Promise.all([
      requestJson({ baseUrl: apiBaseUrl, token: ownerToken, path: "/orgs" }),
      requestJson({ baseUrl: apiBaseUrl, token: ownerToken, path: `/projects/${orgId}` })
    ]);

    const hasOrg = Array.isArray(orgs) && orgs.some((org) => org?.id === orgId);
    const hasProject = Array.isArray(projects) && projects.some((project) => project?.id === projectId);

    if (!hasOrg || !hasProject) {
      fail("onboarding scope validation failed: org/project not found");
    }

    return {
      orgId,
      projectId
    };
  });

  await step("repo_linked", async () => {
    const status = await requestJson({
      baseUrl: apiBaseUrl,
      token: ownerToken,
      path: `/github/installations/status?orgId=${orgId}&projectId=${projectId}`
    });

    const repositories = Array.isArray(status?.repositories) ? status.repositories : [];
    const mapped = repositories.some((repo) => repo?.id === repositoryId);

    if (!mapped) {
      fail("main repository is not mapped in github installation status");
    }

    return {
      repositoryId,
      repositoryCount: repositories.length,
      installationCount: Array.isArray(status?.installations) ? status.installations.length : 0
    };
  });

  const task = await step("task_start", async () =>
    requestJson({
      baseUrl: apiBaseUrl,
      token: extensionToken,
      path: "/tasks/start",
      method: "POST",
      body: {
        orgId,
        projectId,
        repositoryId,
        title: `${runId}: extension task start`
      }
    })
  );
  taskId = task.id;

  await step("guardrail_pre_apply", async () => {
    const evaluation = await requestJson({
      baseUrl: apiBaseUrl,
      token: extensionToken,
      path: "/guardrails/evaluate",
      method: "POST",
      body: {
        projectId,
        taskId,
        stage: "pre_apply",
        changedPaths: ["src/index.ts"]
      }
    });

    if (!evaluation?.blocking) {
      fail("expected pre_apply guardrail evaluation to block src/ changes");
    }

    return {
      evaluationId: evaluation.evaluationId,
      stage: evaluation.stage,
      blocking: evaluation.blocking,
      reasonCodes: evaluation.reasonCodes
    };
  });

  const branch = await step("branch_create", async () =>
    requestJson({
      baseUrl: apiBaseUrl,
      token: extensionToken,
      path: "/branches/create",
      method: "POST",
      body: {
        projectId,
        taskId,
        ticketOrTask: taskId,
        taskSlug: `${runId}-branch-flow`,
        currentBranch: "source-work"
      }
    })
  );

  if (branch?.blocked || !branch?.branch?.id) {
    fail(`branch creation unexpectedly blocked: ${branch?.reason ?? "unknown_reason"}`);
  }
  branchId = branch.branch.id;

  await step("conflict_score", async () =>
    requestJson({
      baseUrl: apiBaseUrl,
      token: extensionToken,
      path: "/conflicts/score",
      method: "POST",
      body: {
        orgId,
        projectId,
        repositoryId,
        taskId,
        overlappingFiles: ["apps/web-console/app/tasks/page.tsx"],
        overlappingSymbols: ["TasksPage"],
        guardrailBoundaryOverlap: 45,
        overlapDensity: 55,
        branchDivergenceCommits: 4,
        staleMinutes: 20,
        ownershipClaimsActive: 1
      }
    })
  );

  const qualityRun = await step("quality_run", async () =>
    requestJson({
      baseUrl: apiBaseUrl,
      token: ownerToken,
      path: "/quality-gates/run",
      method: "POST",
      body: {
        taskId,
        triggerSource: "mvp_gate_pilot"
      }
    })
  );

  const qualityResult = await step("quality_terminal", async () => {
    const run = await waitForQualityTerminal({
      baseUrl: apiBaseUrl,
      token: ownerToken,
      runId: qualityRun.id,
      timeoutMs: args.qualityTimeoutMs
    });

    if (!run?.status) {
      fail("quality terminal run missing status");
    }

    return {
      runId: run.id,
      status: run.status,
      checksSummary: run.checksSummary ?? null
    };
  });

  await step("promotion_gate", async () => {
    const promote = await requestJson({
      baseUrl: apiBaseUrl,
      token: ownerToken,
      path: `/branches/${branchId}/promote`,
      method: "POST",
      body: {
        requireOpenPr: false,
        dryRun: false
      }
    });

    if (promote.promoted) {
      fail("expected promotion to be blocked in pilot quality gate stage");
    }

    return {
      promoted: promote.promoted,
      reason: promote.reason,
      qualityRunId: promote.qualityRunId,
      missingRequiredChecks: promote.missingRequiredChecks
    };
  });

  await step("review_digest", async () => {
    const [digest, slices] = await Promise.all([
      requestJson({
        baseUrl: apiBaseUrl,
        token: ownerToken,
        path: `/tasks/${taskId}/review-digest`
      }),
      requestJson({
        baseUrl: apiBaseUrl,
        token: ownerToken,
        path: `/tasks/${taskId}/pr-slices`
      })
    ]);

    return {
      digestHash: digest.digestHash,
      riskLevel: digest.riskLevel,
      sliceCount: Array.isArray(slices) ? slices.length : 0
    };
  });

  const handoff = await step("handoff_create", async () =>
    requestJson({
      baseUrl: apiBaseUrl,
      token: extensionToken,
      path: `/tasks/${taskId}/handoff`,
      method: "POST",
      body: {}
    })
  );
  handoffId = handoff.id;

  await step("handoff_ack", async () =>
    requestJson({
      baseUrl: apiBaseUrl,
      token: ownerToken,
      path: `/handoffs/${handoffId}/ack`,
      method: "POST",
      body: {
        notes: `${runId}: acknowledged in staging pilot`
      }
    })
  );

  await step("replay_provenance", async () => {
    const [replay, provenance] = await Promise.all([
      requestJson({
        baseUrl: apiBaseUrl,
        token: ownerToken,
        path: `/replay/${taskId}`
      }),
      requestJson({
        baseUrl: apiBaseUrl,
        token: ownerToken,
        path: `/provenance/graph?taskId=${taskId}&includePayload=false`
      })
    ]);

    if (!Array.isArray(replay?.steps)) {
      fail("replay payload missing steps array");
    }

    if (!Array.isArray(provenance?.nodes) || !Array.isArray(provenance?.edges)) {
      fail("provenance graph payload missing nodes/edges");
    }

    return {
      replaySteps: replay.steps.length,
      provenanceNodes: provenance.nodes.length,
      provenanceEdges: provenance.edges.length
    };
  });

  const report = {
    schemaVersion: "1.0.0",
    runId,
    lane: args.lane,
    gitSha: args.gitSha,
    generatedAt: new Date().toISOString(),
    apiBaseUrl,
    orgId,
    projectId,
    repositoryId,
    taskId,
    branchId,
    qualityStatus: qualityResult.status,
    steps
  };

  mkdirSync(dirname(args.outputPath), { recursive: true });
  writeFileSync(args.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`[pilot-flow-staging] wrote ${args.outputPath}`);
}

main().catch((error) => {
  console.error("[pilot-flow-staging] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
