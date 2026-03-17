import { createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const lane =
    argv.find((arg) => arg.startsWith("--lane="))?.slice("--lane=".length) ??
    process.env.BRANCHLINE_CI_LANE ??
    "local";

  return {
    lane,
    runId:
      argv.find((arg) => arg.startsWith("--runId="))?.slice("--runId=".length) ??
      `github-smoke-${new Date().toISOString().replace(/[.:]/g, "-")}-${randomUUID().slice(0, 8)}`,
    gitSha:
      argv.find((arg) => arg.startsWith("--gitSha="))?.slice("--gitSha=".length) ??
      resolveGitSha(),
    allowSkip: argv.includes("--allow-skip"),
    fixturesPath:
      argv.find((arg) => arg.startsWith("--fixtures="))?.slice("--fixtures=".length) ??
      process.env.BRANCHLINE_LIVE_FIXTURES ??
      "artifacts/live-e2e/fixtures.json",
    output:
      argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length) ??
      "artifacts/live-smoke/github-sandbox-smoke.json"
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

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    return undefined;
  }
  return value;
}

function signPayload(secret, payload) {
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  return `sha256=${digest}`;
}

async function requestJson(input) {
  const response = await fetch(`${input.baseUrl}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
      ...(input.body ? { "content-type": "application/json" } : {}),
      ...(input.headers ?? {})
    },
    body: input.body ? JSON.stringify(input.body) : undefined
  });

  const text = await response.text();
  const json = text.length > 0 ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} ${text}`);
  }

  return {
    status: response.status,
    body: json
  };
}

async function waitForQualityTerminal(input) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < input.timeoutMs) {
    const run = await requestJson({
      baseUrl: input.baseUrl,
      path: `/quality-gates/${input.runId}`,
      token: input.token
    });

    const status = run.body?.status;
    if (["passed", "failed", "canceled"].includes(status)) {
      return run.body;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
  }

  throw new Error(`quality run ${input.runId} did not reach terminal state in ${input.timeoutMs}ms`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = resolve(process.cwd(), args.output);
  const fixturesPath = resolve(process.cwd(), args.fixturesPath);

  if (args.allowSkip && (process.env.CI === "true" || args.lane !== "local")) {
    throw new Error("--allow-skip is only permitted for local/dev execution");
  }

  const webhookSecret = requiredEnv("GITHUB_WEBHOOK_SECRET");

  const fixtures = existsSync(fixturesPath)
    ? JSON.parse(readFileSync(fixturesPath, "utf8"))
    : null;

  const apiBaseUrl =
    process.env.BRANCHLINE_API_BASE_URL ?? fixtures?.apiBaseUrl ?? "http://127.0.0.1:4000/v1";
  const authToken =
    requiredEnv("BRANCHLINE_SMOKE_BEARER_TOKEN") ?? fixtures?.users?.owner?.bearerToken;
  const orgId = fixtures?.org?.id;
  const projectId = fixtures?.project?.id;
  const mainRepositoryId = fixtures?.repositories?.main?.id;
  const mainRepoFullName = fixtures?.repositories?.main?.fullName ?? "branchline/live-mvp-main";
  const [repoOwner, repoName] = String(mainRepoFullName).split("/");

  const missing = [];
  if (!authToken) {
    missing.push("BRANCHLINE_SMOKE_BEARER_TOKEN (or fixtures.users.owner.bearerToken)");
  }
  if (!webhookSecret) {
    missing.push("GITHUB_WEBHOOK_SECRET");
  }
  if (!orgId || !projectId || !mainRepositoryId) {
    missing.push("fixtures.org/project/repositories.main");
  }

  if (missing.length > 0) {
    const skippedPayload = {
      generatedAt: new Date().toISOString(),
      schemaVersion: "1.1.0",
      runId: args.runId,
      lane: args.lane,
      gitSha: args.gitSha,
      skipped: true,
      reason: `Missing required inputs: ${missing.join(", ")}`,
      checks: []
    };

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(skippedPayload, null, 2)}\n`, "utf8");

    if (args.allowSkip) {
      console.log(`[github-smoke] skipped: ${skippedPayload.reason}`);
      return;
    }

    throw new Error(skippedPayload.reason);
  }

  const checks = [];
  const pushCheck = (check) => checks.push(check);

  const installationId = Number(fixtures?.github?.installationId ?? 900_001);

  const installSync = await requestJson({
    baseUrl: apiBaseUrl,
    path: "/github/installations/sync",
    method: "POST",
    token: authToken,
    body: {
      orgId,
      projectId,
      githubInstallationId: installationId,
      accountLogin: repoOwner,
      accountType: "Organization",
      repositories: [
        {
          providerRepoId: `${repoOwner}/${repoName}`,
          owner: repoOwner,
          name: repoName,
          defaultBranch: "main",
          isPrivate: true,
          metadata: {
            source: "github-sandbox-smoke"
          },
          projectId
        }
      ]
    }
  });

  pushCheck({
    name: "installation_sync",
    ok: installSync.body.repositoriesSynced >= 1,
    status: installSync.status,
    response: installSync.body
  });

  const webhookPayload = {
    action: "synchronize",
    installation: {
      id: installationId,
      account: {
        login: repoOwner,
        type: "Organization"
      }
    },
    repository: {
      id: 930_100,
      name: repoName,
      full_name: `${repoOwner}/${repoName}`,
      private: true,
      default_branch: "main",
      owner: {
        login: repoOwner
      }
    },
    pull_request: {
      id: 930_400,
      number: 41,
      state: "open",
      draft: false,
      head: {
        ref: "branchline/sandbox-smoke"
      },
      base: {
        ref: "main"
      }
    }
  };

  const webhookBody = JSON.stringify(webhookPayload);
  const deliveryId = randomUUID();

  const signedWebhook = await fetch(`${apiBaseUrl}/github/webhooks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-delivery": deliveryId,
      "x-github-event": "pull_request",
      "x-hub-signature-256": signPayload(webhookSecret, webhookBody)
    },
    body: webhookBody
  });

  const signedWebhookBody = await signedWebhook.text();
  pushCheck({
    name: "webhook_signed_delivery",
    ok: signedWebhook.ok,
    status: signedWebhook.status,
    response: signedWebhookBody ? JSON.parse(signedWebhookBody) : {}
  });

  const invalidWebhook = await fetch(`${apiBaseUrl}/github/webhooks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-delivery": `invalid-${deliveryId}`,
      "x-github-event": "pull_request",
      "x-hub-signature-256": "sha256=000000"
    },
    body: webhookBody
  });

  pushCheck({
    name: "webhook_invalid_signature_rejected",
    ok: invalidWebhook.status === 401,
    status: invalidWebhook.status
  });

  const reconcile = await requestJson({
    baseUrl: apiBaseUrl,
    path: "/github/reconcile",
    method: "POST",
    token: authToken,
    body: {
      orgId,
      projectId,
      limit: 20
    }
  });

  const reconcileFailClosed = reconcile.body?.reason === "github_app_credentials_missing";
  const reconcileStatusOk = reconcile.status === 200 || reconcile.status === 201;
  pushCheck({
    name: "reconcile_or_fail_closed",
    ok: reconcileStatusOk && (reconcileFailClosed || typeof reconcile.body?.scanned === "number"),
    status: reconcile.status,
    response: reconcile.body
  });

  const noInstallRepoName = `smoke-no-install-${Date.now()}`;
  const noInstallRepo = await requestJson({
    baseUrl: apiBaseUrl,
    path: "/repositories/bind",
    method: "POST",
    token: authToken,
    body: {
      projectId,
      provider: "github",
      providerRepoId: `${repoOwner}/${noInstallRepoName}`,
      owner: repoOwner,
      name: noInstallRepoName,
      defaultBranch: "main",
      isPrivate: true
    }
  });

  const failClosedTask = await requestJson({
    baseUrl: apiBaseUrl,
    path: "/tasks/start",
    method: "POST",
    token: authToken,
    body: {
      orgId,
      projectId,
      repositoryId: noInstallRepo.body.id,
      title: `GitHub fail-closed task ${Date.now()}`
    }
  });

  const failClosedBranch = await requestJson({
    baseUrl: apiBaseUrl,
    path: "/branches/create",
    method: "POST",
    token: authToken,
    body: {
      projectId,
      taskId: failClosedTask.body.id,
      ticketOrTask: failClosedTask.body.id,
      taskSlug: "smoke-fail-closed",
      currentBranch: "source-work"
    }
  });

  const failClosedPr = await requestJson({
    baseUrl: apiBaseUrl,
    path: `/branches/${failClosedBranch.body.branch.id}/ensure-pr`,
    method: "POST",
    token: authToken,
    body: {
      title: "Smoke fail-closed PR",
      draft: true
    }
  });

  const ensureReason = String(failClosedPr.body.reason ?? "");
  pushCheck({
    name: "ensure_pr_fail_closed_missing_context",
    ok: ensureReason.startsWith("fail_closed:github_installation_not_resolved") || ensureReason.startsWith("fail_closed:github_app_credentials_missing"),
    status: failClosedPr.status,
    response: failClosedPr.body
  });

  const qualityTask = await requestJson({
    baseUrl: apiBaseUrl,
    path: "/tasks/start",
    method: "POST",
    token: authToken,
    body: {
      orgId,
      projectId,
      repositoryId: mainRepositoryId,
      title: `GitHub quality gate task ${Date.now()}`
    }
  });

  const qualityBranch = await requestJson({
    baseUrl: apiBaseUrl,
    path: "/branches/create",
    method: "POST",
    token: authToken,
    body: {
      projectId,
      taskId: qualityTask.body.id,
      ticketOrTask: qualityTask.body.id,
      taskSlug: "smoke-quality-block",
      currentBranch: "source-work"
    }
  });

  pushCheck({
    name: "branch_create_success_installed_repo",
    ok: Boolean(qualityBranch.body?.branch?.id),
    status: qualityBranch.status,
    response: {
      blocked: qualityBranch.body?.blocked ?? false,
      reason: qualityBranch.body?.reason ?? null,
      branchId: qualityBranch.body?.branch?.id ?? null
    }
  });

  const ensurePr = await requestJson({
    baseUrl: apiBaseUrl,
    path: `/branches/${qualityBranch.body.branch.id}/ensure-pr`,
    method: "POST",
    token: authToken,
    body: {
      title: "Smoke quality blocked PR",
      draft: true
    }
  }).catch((error) => ({
    status: 500,
    body: {
      reason: error instanceof Error ? error.message : String(error)
    }
  }));

  const ensurePrReason = String(ensurePr.body?.reason ?? "");
  const ensurePrStatusOk = ensurePr.status === 200 || ensurePr.status === 201;
  const ensurePrHasResultShape =
    typeof ensurePr.body?.created === "boolean" || Boolean(ensurePr.body?.pullRequest?.id);
  const ensurePrFailClosedMissingCreds =
    ensurePrReason === "fail_closed:github_app_credentials_missing";
  pushCheck({
    name: "ensure_pr_success_installed_repo",
    ok:
      ensurePrStatusOk &&
      ensurePrHasResultShape &&
      (!ensurePrReason.startsWith("fail_closed:") || ensurePrFailClosedMissingCreds),
    status: ensurePr.status,
    response: ensurePr.body
  });

  const run = await requestJson({
    baseUrl: apiBaseUrl,
    path: "/quality-gates/run",
    method: "POST",
    token: authToken,
    body: {
      taskId: qualityTask.body.id,
      triggerSource: "github_sandbox_smoke"
    }
  });

  const terminalRun = await waitForQualityTerminal({
    baseUrl: apiBaseUrl,
    token: authToken,
    runId: run.body.id,
    timeoutMs: 90_000
  });

  const promote = await requestJson({
    baseUrl: apiBaseUrl,
    path: `/branches/${qualityBranch.body.branch.id}/promote`,
    method: "POST",
    token: authToken,
    body: {
      requireOpenPr: false,
      dryRun: false
    }
  });

  const promoteReason = String(promote.body.reason ?? "");
  const blockedByQuality =
    promote.body.promoted === false &&
    (promoteReason === "quality_required_checks_failed" || promoteReason.startsWith("quality_status_") || promoteReason === "quality_run_missing");

  pushCheck({
    name: "quality_required_checks_block_promotion",
    ok: blockedByQuality,
    status: promote.status,
    response: {
      qualityRunStatus: terminalRun.status,
      promoted: promote.body.promoted,
      reason: promote.body.reason,
      missingRequiredChecks: promote.body.missingRequiredChecks
    }
  });

  const report = {
    schemaVersion: "1.1.0",
    runId: args.runId,
    lane: args.lane,
    gitSha: args.gitSha,
    generatedAt: new Date().toISOString(),
    skipped: false,
    checks
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const failedChecks = checks.filter((check) => check.ok !== true);
  if (failedChecks.length > 0) {
    throw new Error(`GitHub sandbox smoke failed (${failedChecks.length} failing checks). See ${outputPath}`);
  }

  console.log(`[github-smoke] passed. report=${outputPath}`);
}

main().catch((error) => {
  console.error("[github-smoke] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
