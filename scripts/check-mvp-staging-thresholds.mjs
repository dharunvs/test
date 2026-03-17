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
      read("--output=") ?? "artifacts/mvp-gate/staging-checks.json"
    ),
    lane: read("--lane=") ?? process.env.BRANCHLINE_CI_LANE ?? "local",
    runId: read("--runId=") ?? `staging-checks-${new Date().toISOString().replace(/[.:]/g, "-")}-${randomUUID().slice(0, 8)}`,
    gitSha: read("--gitSha=") ?? resolveGitSha(),
    windowMinutes: Number(read("--windowMinutes=") ?? 60),
    branchCreateMaxMs: Number(read("--branchCreateMaxMs=") ?? 5_000),
    realtimeP95MaxMs: Number(read("--realtimeP95MaxMs=") ?? 2_000)
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

async function request(path, options) {
  const response = await fetch(`${options.baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    text,
    json
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = JSON.parse(readFileSync(args.fixturesPath, "utf8"));

  const baseUrl = fixtures?.apiBaseUrl;
  const orgId = fixtures?.org?.id;
  const projectId = fixtures?.project?.id;
  const repositoryId = fixtures?.repositories?.main?.id;
  const ownerToken = fixtures?.users?.owner?.bearerToken;
  const adminToken = fixtures?.users?.admin?.bearerToken;
  const memberToken = fixtures?.users?.member?.bearerToken;
  const viewerToken = fixtures?.users?.viewer?.bearerToken;

  if (!baseUrl || !orgId || !projectId || !repositoryId || !ownerToken || !adminToken || !memberToken || !viewerToken) {
    throw new Error("fixtures are missing required ids/tokens for staging checks");
  }

  const checks = [];

  const pushCheck = (check) => {
    checks.push({
      ...check,
      at: new Date().toISOString()
    });
  };

  const realtime = await request(
    `/observability/realtime-latency?projectId=${projectId}&windowMinutes=${args.windowMinutes}`,
    {
      baseUrl,
      token: ownerToken
    }
  );
  if (!realtime.ok || !realtime.json) {
    throw new Error(`failed realtime latency check: ${realtime.status} ${realtime.text}`);
  }

  pushCheck({
    name: "realtime_latency_p95",
    ok: realtime.json.p95Ms <= args.realtimeP95MaxMs,
    expected: `p95Ms <= ${args.realtimeP95MaxMs}`,
    observed: realtime.json.p95Ms,
    details: realtime.json
  });

  const webhookPayload = {
    action: "synchronize",
    installation: { id: fixtures?.github?.installationId ?? 900_001 },
    repository: {
      id: 902_100,
      name: "live-mvp-main",
      full_name: "branchline/live-mvp-main",
      owner: {
        login: "branchline"
      }
    },
    pull_request: {
      number: 99,
      state: "open",
      draft: false,
      head: {
        ref: "branchline/smoke"
      },
      base: {
        ref: "main"
      }
    }
  };

  const invalidWebhook = await fetch(`${baseUrl}/github/webhooks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-delivery": `invalid-${Date.now()}`,
      "x-github-event": "pull_request",
      "x-hub-signature-256": "sha256=000000"
    },
    body: JSON.stringify(webhookPayload)
  });

  pushCheck({
    name: "webhook_invalid_signature_rejected",
    ok: invalidWebhook.status === 401,
    expected: "401",
    observed: invalidWebhook.status
  });

  const taskStart = await request("/tasks/start", {
    baseUrl,
    token: ownerToken,
    method: "POST",
    body: {
      orgId,
      projectId,
      repositoryId,
      title: `Staging branch latency ${Date.now()}`
    }
  });
  if (!taskStart.ok || !taskStart.json?.id) {
    throw new Error(`failed to create task for branch latency check: ${taskStart.status} ${taskStart.text}`);
  }

  const branchStart = Date.now();
  const branchCreate = await request("/branches/create", {
    baseUrl,
    token: ownerToken,
    method: "POST",
    body: {
      projectId,
      taskId: taskStart.json.id,
      ticketOrTask: taskStart.json.id,
      taskSlug: "staging-latency-check",
      currentBranch: "source-work"
    }
  });
  const branchDurationMs = Date.now() - branchStart;

  if (!branchCreate.ok || branchCreate.json?.blocked || !branchCreate.json?.branch?.id) {
    throw new Error(
      `failed to create branch for latency check: ${branchCreate.status} ${branchCreate.text}`
    );
  }

  pushCheck({
    name: "branch_orchestration_latency",
    ok: branchDurationMs <= args.branchCreateMaxMs,
    expected: `<= ${args.branchCreateMaxMs}ms`,
    observed: `${branchDurationMs}ms`,
    branchId: branchCreate.json.branch.id
  });

  const promote = await request(`/branches/${branchCreate.json.branch.id}/promote`, {
    baseUrl,
    token: ownerToken,
    method: "POST",
    body: {
      requireOpenPr: false,
      dryRun: false
    }
  });

  if (!promote.ok || !promote.json) {
    throw new Error(`failed promotion gate check: ${promote.status} ${promote.text}`);
  }

  const promotionBlockedReasons = ["quality_run_missing", "quality_required_checks_failed", "quality_status_failed"];
  const promotionBlocked =
    promote.json.promoted === false &&
    promotionBlockedReasons.some((reason) => String(promote.json.reason ?? "").startsWith(reason));

  pushCheck({
    name: "required_quality_checks_block_promotion",
    ok: promotionBlocked,
    expected: "promotion blocked by quality requirements",
    observed: {
      promoted: promote.json.promoted,
      reason: promote.json.reason
    }
  });

  const viewerBind = await request("/repositories/bind", {
    baseUrl,
    token: viewerToken,
    method: "POST",
    body: {
      projectId,
      provider: "github",
      providerRepoId: `branchline/rbac-viewer-${Date.now()}`,
      owner: "branchline",
      name: `rbac-viewer-${Date.now()}`,
      defaultBranch: "main",
      isPrivate: true
    }
  });

  pushCheck({
    name: "rbac_viewer_denied_repository_bind",
    ok: viewerBind.status === 403,
    expected: 403,
    observed: viewerBind.status
  });

  const memberInvite = await request("/memberships/invite", {
    baseUrl,
    token: memberToken,
    method: "POST",
    body: {
      orgId,
      email: `rbac-member-invite-${Date.now()}@branchline.dev`,
      role: "viewer",
      expiresInDays: 1
    }
  });

  pushCheck({
    name: "rbac_member_denied_invite",
    ok: memberInvite.status === 403,
    expected: 403,
    observed: memberInvite.status
  });

  const probeEmail = `rbac-admin-invite-${Date.now()}@branchline.dev`;
  const adminInvite = await request("/memberships/invite", {
    baseUrl,
    token: adminToken,
    method: "POST",
    body: {
      orgId,
      email: probeEmail,
      role: "viewer",
      expiresInDays: 1
    }
  });

  pushCheck({
    name: "rbac_admin_allowed_invite",
    ok: adminInvite.ok && Boolean(adminInvite.json?.inviteId),
    expected: "200 with inviteId",
    observed: {
      status: adminInvite.status,
      inviteId: adminInvite.json?.inviteId ?? null
    }
  });

  if (adminInvite.ok && adminInvite.json?.inviteId) {
    await request("/memberships/revoke", {
      baseUrl,
      token: ownerToken,
      method: "POST",
      body: {
        inviteId: adminInvite.json.inviteId
      }
    }).catch(() => null);
  }

  const failed = checks.filter((check) => !check.ok);

  const report = {
    schemaVersion: "1.0.0",
    runId: args.runId,
    lane: args.lane,
    gitSha: args.gitSha,
    generatedAt: new Date().toISOString(),
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length
    }
  };

  mkdirSync(dirname(args.outputPath), { recursive: true });
  writeFileSync(args.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`[staging-checks] wrote ${args.outputPath}`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[staging-checks] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
