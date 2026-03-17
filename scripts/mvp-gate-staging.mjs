import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const DEFAULT_CONTRACT_PATH = resolve(
  process.cwd(),
  "docs/04_delivery/04_live_input_contract.json"
);

const EXPECTED_PILOT_STEPS = [
  "onboarding_scope",
  "repo_linked",
  "task_start",
  "guardrail_pre_apply",
  "branch_create",
  "conflict_score",
  "quality_run",
  "quality_terminal",
  "promotion_gate",
  "review_digest",
  "handoff_create",
  "handoff_ack",
  "replay_provenance"
];

const ARTIFACT_SCHEMAS = {
  "live-prereqs": "1.1.0",
  fixtures: "1.0.0",
  "pilot-flow": "1.0.0",
  "staging-checks": "1.0.0",
  "pilot-kpis": "1.0.0",
  "github-smoke": "1.1.0"
};

function parseArgs(argv) {
  const read = (prefix) => argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const outputDirArg = read("--outputDir=");
  const runId =
    read("--runId=") ??
    process.env.BRANCHLINE_GATE_RUN_ID ??
    `mvp-gate-${new Date().toISOString().replace(/[.:]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const outputRoot = resolve(process.cwd(), read("--outputRoot=") ?? "artifacts/mvp-gate");
  const outputDir = outputDirArg ? resolve(process.cwd(), outputDirArg) : resolve(outputRoot, runId);

  return {
    runId,
    lane: read("--lane=") ?? process.env.BRANCHLINE_CI_LANE ?? "local",
    gitSha: read("--gitSha=") ?? resolveGitSha(),
    outputRoot,
    outputDir,
    summaryName: read("--summaryName=") ?? "gate-summary.json",
    fixturesPath: resolve(
      process.cwd(),
      read("--fixtures=") ?? process.env.BRANCHLINE_LIVE_FIXTURES ?? "artifacts/live-e2e/fixtures.json"
    ),
    livePrereqsPath: resolve(
      process.cwd(),
      read("--live-prereqs=") ?? `${outputDir}/live-prereqs.json`
    ),
    contractPath: resolve(
      process.cwd(),
      read("--contract=") ?? process.env.BRANCHLINE_LIVE_CONTRACT_PATH ?? DEFAULT_CONTRACT_PATH
    ),
    playwrightBaseUrl: read("--playwrightBaseUrl=") ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    fixturesMaxAgeMinutes: Number(read("--fixturesMaxAgeMinutes=") ?? 45),
    skipStaticLivePrereqs: argv.includes("--skip-static-live-prereqs"),
    skipLivePrereqProbe: argv.includes("--skip-live-prereq-probe"),
    skipFixtureBootstrap: argv.includes("--skip-fixture-bootstrap"),
    skipFeatureGates: argv.includes("--skip-feature-gates"),
    skipLiveWebE2e: argv.includes("--skip-live-web-e2e"),
    skipLiveExtensionE2e: argv.includes("--skip-live-extension-e2e"),
    skipPilotFlow: argv.includes("--skip-pilot-flow"),
    skipStagingChecks: argv.includes("--skip-staging-checks"),
    skipLiveSmoke: argv.includes("--skip-live-smoke"),
    skipPilotKpis: argv.includes("--skip-pilot-kpis"),
    allowPartial: argv.includes("--allow-partial")
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

function ensureDir(path) {
  mkdirSync(path, {
    recursive: true
  });
}

function parseJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function runCommandStep(step, outputDir, env) {
  const startedAt = new Date();
  const result = spawnSync(step.command, {
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
    env
  });

  const endedAt = new Date();
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const logPath = resolve(outputDir, `${step.id}.log`);
  writeFileSync(logPath, output, "utf8");

  if (output.trim().length > 0) {
    process.stdout.write(output);
  }

  return {
    id: step.id,
    command: step.command,
    required: step.required,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status ?? 1,
    logPath
  };
}

function runInlineStep(step, outputDir, executor) {
  const startedAt = new Date();
  let status = "passed";
  let exitCode = 0;
  let output = "";
  try {
    output = executor();
  } catch (error) {
    status = "failed";
    exitCode = 1;
    output = error instanceof Error ? error.message : String(error);
  }

  const endedAt = new Date();
  const logPath = resolve(outputDir, `${step.id}.log`);
  writeFileSync(logPath, `${output}\n`, "utf8");
  if (output.trim().length > 0) {
    process.stdout.write(`${output}\n`);
  }

  return {
    id: step.id,
    command: step.command ?? "inline",
    required: step.required,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    status,
    exitCode,
    logPath
  };
}

function hydrateLiveEnvFromFixtures(fixturesPath, env) {
  if (!existsSync(fixturesPath)) {
    throw new Error(`fixtures file missing: ${fixturesPath}`);
  }

  const fixtures = parseJson(fixturesPath);
  const required = [
    ["apiBaseUrl", fixtures?.apiBaseUrl],
    ["org.id", fixtures?.org?.id],
    ["project.id", fixtures?.project?.id],
    ["repositories.main.id", fixtures?.repositories?.main?.id],
    ["repositories.mismatch.id", fixtures?.repositories?.mismatch?.id],
    ["users.owner.bearerToken", fixtures?.users?.owner?.bearerToken],
    ["users.extension.bearerToken", fixtures?.users?.extension?.bearerToken],
    ["users.admin.bearerToken", fixtures?.users?.admin?.bearerToken],
    ["users.member.bearerToken", fixtures?.users?.member?.bearerToken],
    ["users.viewer.bearerToken", fixtures?.users?.viewer?.bearerToken]
  ];

  const missing = required
    .filter((entry) => !entry[1])
    .map((entry) => entry[0]);
  if (missing.length > 0) {
    throw new Error(`fixtures missing required fields: ${missing.join(", ")}`);
  }

  env.BRANCHLINE_LIVE_FIXTURES = fixturesPath;
  env.BRANCHLINE_API_BASE_URL = env.BRANCHLINE_API_BASE_URL ?? fixtures.apiBaseUrl;
  env.BRANCHLINE_STAGING_API_BASE_URL = env.BRANCHLINE_STAGING_API_BASE_URL ?? fixtures.apiBaseUrl;
  env.PLAYWRIGHT_BASE_URL = env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
  env.BRANCHLINE_E2E_BEARER_TOKEN =
    env.BRANCHLINE_E2E_BEARER_TOKEN ?? fixtures.users.owner.bearerToken;
  env.BRANCHLINE_SMOKE_BEARER_TOKEN =
    env.BRANCHLINE_SMOKE_BEARER_TOKEN ?? fixtures.users.owner.bearerToken;
  env.BRANCHLINE_LIVE_ORG_ID = fixtures.org.id;
  env.BRANCHLINE_LIVE_PROJECT_ID = fixtures.project.id;
  env.BRANCHLINE_LIVE_REPOSITORY_ID = fixtures.repositories.main.id;

  return fixtures;
}

function validateGeneratedAt(artifact, payload, input, errors) {
  if (!payload?.generatedAt) {
    errors.push(`artifact_missing_generated_at:${artifact.id}`);
    return;
  }

  const generatedAtMs = Date.parse(payload.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    errors.push(`artifact_generated_at_invalid:${artifact.id}`);
    return;
  }

  const maxAgeMs = artifact.maxAgeMs ?? input.maxArtifactAgeMs;
  if (input.endedAtMs - generatedAtMs > maxAgeMs) {
    errors.push(`stale_generated_at:${artifact.id}`);
  }

  if (generatedAtMs < input.startedAtMs - 5_000) {
    errors.push(`generated_before_gate_start:${artifact.id}`);
  }
}

function validateEnvelope(artifact, payload, report, errors) {
  const keys = ["runId", "lane", "gitSha", "generatedAt"];
  for (const key of keys) {
    if (!payload?.[key]) {
      errors.push(`artifact_missing_${key}:${artifact.id}`);
    }
  }

  if (payload?.runId && payload.runId !== report.runId) {
    errors.push(`artifact_run_id_mismatch:${artifact.id}`);
  }
  if (payload?.lane && payload.lane !== report.lane) {
    errors.push(`artifact_lane_mismatch:${artifact.id}`);
  }
  if (payload?.gitSha && payload.gitSha !== report.gitSha) {
    errors.push(`artifact_git_sha_mismatch:${artifact.id}`);
  }
}

function validatePilotFlow(pilot, errors) {
  if (!pilot?.runId) {
    errors.push("pilot_flow_missing_run_id");
  }

  if (!Array.isArray(pilot?.steps) || pilot.steps.length === 0) {
    errors.push("pilot_flow_missing_steps");
    return;
  }

  const failedSteps = pilot.steps.filter((step) => step?.status !== "passed");
  if (failedSteps.length > 0) {
    errors.push(`pilot_flow_contains_failed_steps:${failedSteps.length}`);
  }

  const stepIds = pilot.steps.map((step) => step?.id).filter(Boolean);
  if (stepIds.length !== EXPECTED_PILOT_STEPS.length) {
    errors.push(`pilot_flow_step_count_mismatch:${stepIds.length}`);
    return;
  }

  for (let index = 0; index < EXPECTED_PILOT_STEPS.length; index += 1) {
    if (stepIds[index] !== EXPECTED_PILOT_STEPS[index]) {
      errors.push(
        `pilot_flow_stage_transition_mismatch:${EXPECTED_PILOT_STEPS[index]}!=${stepIds[index] ?? "missing"}`
      );
      break;
    }
  }
}

function validateStagingChecks(checks, errors) {
  const failedCount = Number(checks?.summary?.failed ?? 0);
  if (failedCount > 0) {
    errors.push(`staging_checks_failed:${failedCount}`);
  }
}

function validateGithubSmoke(smoke, errors) {
  if (smoke?.skipped === true) {
    errors.push("github_smoke_skipped");
  }

  const requiredChecks = [
    "installation_sync",
    "webhook_signed_delivery",
    "webhook_invalid_signature_rejected",
    "reconcile_or_fail_closed",
    "branch_create_success_installed_repo",
    "ensure_pr_success_installed_repo",
    "ensure_pr_fail_closed_missing_context",
    "quality_required_checks_block_promotion"
  ];

  if (!Array.isArray(smoke?.checks)) {
    errors.push("github_smoke_checks_missing");
    return;
  }

  const failedChecks = smoke.checks.filter((check) => check?.ok !== true);
  if (failedChecks.length > 0) {
    errors.push(`github_smoke_failed_checks:${failedChecks.length}`);
  }

  const checkNames = new Set(smoke.checks.map((check) => check?.name));
  const missingChecks = requiredChecks.filter((name) => !checkNames.has(name));
  if (missingChecks.length > 0) {
    errors.push(`github_smoke_missing_checks:${missingChecks.join(",")}`);
  }
}

function validatePilotKpis(kpis, errors) {
  if (!kpis?.metrics || typeof kpis.metrics !== "object") {
    errors.push("pilot_kpis_metrics_missing");
    return;
  }

  const numericKeys = [
    "totalTasks",
    "tasksWithConflict",
    "conflictRate",
    "averageReviewMinutes",
    "averageBaselineReviewMinutes",
    "reviewTimeDeltaMinutes",
    "reviewTimeDeltaPercent"
  ];

  for (const key of numericKeys) {
    if (typeof kpis.metrics[key] !== "number" || Number.isNaN(kpis.metrics[key])) {
      errors.push(`pilot_kpis_metric_invalid:${key}`);
    }
  }
}

function validateLivePrereqs(prereqs, errors) {
  const failed = Number(prereqs?.summary?.failed ?? 0);
  if (failed > 0) {
    errors.push(`live_prereqs_failed:${failed}`);
  }
}

function validateArtifacts(input, reportMeta) {
  const errors = [];
  const details = [];
  const parsedById = {};

  for (const artifact of input.artifacts) {
    const exists = existsSync(artifact.path);
    if (!exists) {
      errors.push(`missing_artifact:${artifact.id}`);
      details.push({ id: artifact.id, path: artifact.path, exists: false });
      continue;
    }

    const stats = statSync(artifact.path);
    if (stats.mtimeMs < input.startedAtMs) {
      errors.push(`stale_mtime:${artifact.id}`);
    }

    let payload = null;
    try {
      payload = parseJson(artifact.path);
      parsedById[artifact.id] = payload;
    } catch (error) {
      errors.push(`artifact_json_invalid:${artifact.id}`);
      details.push({
        id: artifact.id,
        path: artifact.path,
        exists: true,
        mtimeMs: stats.mtimeMs,
        jsonValid: false,
        message: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    const expectedSchema = ARTIFACT_SCHEMAS[artifact.id];
    if (expectedSchema && payload?.schemaVersion !== expectedSchema) {
      errors.push(`artifact_schema_mismatch:${artifact.id}:${payload?.schemaVersion ?? "missing"}`);
    }

    validateEnvelope(artifact, payload, reportMeta, errors);
    validateGeneratedAt(artifact, payload, input, errors);

    details.push({
      id: artifact.id,
      path: artifact.path,
      exists: true,
      mtimeMs: stats.mtimeMs,
      schemaVersion: payload?.schemaVersion ?? null
    });
  }

  if (parsedById["live-prereqs"]) {
    validateLivePrereqs(parsedById["live-prereqs"], errors);
  }
  if (parsedById["pilot-flow"]) {
    validatePilotFlow(parsedById["pilot-flow"], errors);
  }
  if (parsedById["staging-checks"]) {
    validateStagingChecks(parsedById["staging-checks"], errors);
  }
  if (parsedById["github-smoke"]) {
    validateGithubSmoke(parsedById["github-smoke"], errors);
  }
  if (parsedById["pilot-kpis"]) {
    validatePilotKpis(parsedById["pilot-kpis"], errors);
  }

  return {
    errors,
    details
  };
}

function createChecklist(report, outputDir) {
  const lines = [
    "# MVP Strict Gate Checklist",
    "",
    `Run ID: ${report.runId}`,
    `Lane: ${report.lane}`,
    `Git SHA: ${report.gitSha}`,
    `Generated at: ${report.generatedAt}`,
    `Output directory: ${outputDir}`,
    "",
    "## Step Results",
    ...report.steps.map(
      (step) =>
        `- [${step.status === "passed" ? "x" : " "}] ${step.id} (${step.required ? "required" : "optional"}) - log: ${step.logPath}`
    ),
    "",
    "## Evidence Artifacts",
    ...report.artifacts.map((artifact) => `- ${artifact.id}: ${artifact.path}`),
    "",
    "## Artifact Validation",
    ...report.artifactValidation.details.map((detail) =>
      `- ${detail.id}: ${detail.exists ? "present" : "missing"} (${detail.path})`
    ),
    ...(report.artifactValidation.errors.length > 0
      ? ["", "Validation errors:", ...report.artifactValidation.errors.map((error) => `- ${error}`)]
      : []),
    "",
    "## Overall",
    `- Gate status: ${report.gateStatus}`,
    `- Required steps failed: ${report.requiredFailures.length}`,
    `- Required steps skipped: ${report.requiredSkips.length}`,
    `- Optional steps failed: ${report.optionalFailures.length}`
  ];

  const checklistPath = resolve(outputDir, "release-checklist.md");
  writeFileSync(checklistPath, `${lines.join("\n")}\n`, "utf8");
  return checklistPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const strictLane = args.lane === "nightly" || args.lane === "rc";
  const strictOrchestrated = process.env.BRANCHLINE_STRICT_ORCHESTRATED === "1";

  if (strictLane && args.allowPartial) {
    throw new Error("--allow-partial is not permitted for strict lanes (nightly/rc)");
  }

  const strictForbiddenSkips = [
    ["--skip-feature-gates", args.skipFeatureGates],
    ["--skip-fixture-bootstrap", args.skipFixtureBootstrap],
    ["--skip-live-prereq-probe", args.skipLivePrereqProbe],
    ["--skip-live-web-e2e", args.skipLiveWebE2e],
    ["--skip-live-extension-e2e", args.skipLiveExtensionE2e],
    ["--skip-live-smoke", args.skipLiveSmoke],
    ["--skip-pilot-flow", args.skipPilotFlow],
    ["--skip-staging-checks", args.skipStagingChecks],
    ["--skip-pilot-kpis", args.skipPilotKpis]
  ]
    .filter((entry) => entry[1])
    .map((entry) => entry[0]);

  if (strictLane && strictForbiddenSkips.length > 0) {
    throw new Error(
      `strict lanes do not permit required-step skip flags: ${strictForbiddenSkips.join(", ")}`
    );
  }

  if (strictLane && args.skipStaticLivePrereqs && !strictOrchestrated) {
    throw new Error(
      "--skip-static-live-prereqs is only permitted when orchestrated by mvp:gate:live"
    );
  }

  const outputDir = args.outputDir;
  ensureDir(outputDir);

  const pilotOutput = resolve(outputDir, "pilot-flow.json");
  const checksOutput = resolve(outputDir, "staging-checks.json");
  const smokeOutput = resolve(outputDir, "github-sandbox-smoke.json");
  const kpiOutput = resolve(outputDir, "pilot-kpis.json");

  const env = {
    ...process.env,
    BRANCHLINE_CI_LANE: args.lane,
    BRANCHLINE_GATE_RUN_ID: args.runId,
    BRANCHLINE_LIVE_CONTRACT_PATH: args.contractPath,
    PLAYWRIGHT_BASE_URL: args.playwrightBaseUrl
  };

  const steps = [
    {
      id: "static-live-prereqs",
      command: `pnpm live:preflight --strict --lane=${args.lane} --runId=${args.runId} --gitSha=${args.gitSha} --contract=${args.contractPath} --output=${args.livePrereqsPath}`,
      enabled: !args.skipStaticLivePrereqs,
      required: !args.skipStaticLivePrereqs
    },
    {
      id: "feature-gates-verify",
      command: "pnpm feature-gates:verify",
      enabled: !args.skipFeatureGates,
      required: true
    },
    {
      id: "fixtures-bootstrap",
      command: `pnpm seed:live:e2e --runId=${args.runId} --lane=${args.lane} --gitSha=${args.gitSha} --output=${args.fixturesPath}`,
      enabled: !args.skipFixtureBootstrap,
      required: true
    },
    {
      id: "fixtures-validate",
      enabled: true,
      required: true,
      inline: true
    },
    {
      id: "live-prereqs-probe",
      command: `pnpm live:preflight --strict --probe-api --probe-github-status --fixtures=${args.fixturesPath} --lane=${args.lane} --runId=${args.runId} --gitSha=${args.gitSha} --contract=${args.contractPath} --output=${args.livePrereqsPath}`,
      enabled: !args.skipLivePrereqProbe,
      required: true
    },
    {
      id: "live-web-e2e",
      command: "pnpm e2e:web:live",
      enabled: !args.skipLiveWebE2e,
      required: true
    },
    {
      id: "live-extension-e2e",
      command: "pnpm e2e:extension:live",
      enabled: !args.skipLiveExtensionE2e,
      required: true
    },
    {
      id: "github-sandbox-smoke",
      command: `pnpm github:sandbox:smoke --lane=${args.lane} --runId=${args.runId} --gitSha=${args.gitSha} --fixtures=${args.fixturesPath} --output=${smokeOutput}`,
      enabled: !args.skipLiveSmoke,
      required: true
    },
    {
      id: "pilot-flow-staging",
      command: `pnpm mvp:pilot-flow:staging --runId=${args.runId} --lane=${args.lane} --gitSha=${args.gitSha} --fixtures=${args.fixturesPath} --output=${pilotOutput}`,
      enabled: !args.skipPilotFlow,
      required: true
    },
    {
      id: "staging-checks",
      command: `pnpm mvp:checks:staging --runId=${args.runId} --lane=${args.lane} --gitSha=${args.gitSha} --fixtures=${args.fixturesPath} --output=${checksOutput}`,
      enabled: !args.skipStagingChecks,
      required: true
    },
    {
      id: "pilot-kpis",
      command: `pnpm kpi:pilot --allow-empty --runId=${args.runId} --lane=${args.lane} --gitSha=${args.gitSha} --output=${kpiOutput}`,
      enabled: !args.skipPilotKpis,
      required: true
    }
  ];

  const results = [];
  const startedAtMs = Date.now();

  for (const step of steps) {
    if (!step.enabled) {
      results.push({
        id: step.id,
        command: step.command ?? "inline",
        required: step.required,
        status: "skipped",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 0,
        exitCode: 0,
        logPath: ""
      });
      continue;
    }

    const result = step.inline
      ? runInlineStep(step, outputDir, () => {
          const fixtures = hydrateLiveEnvFromFixtures(args.fixturesPath, env);
          return `fixtures validated: org=${fixtures.org.id} project=${fixtures.project.id} repo=${fixtures.repositories.main.id}`;
        })
      : runCommandStep(step, outputDir, env);

    results.push(result);
    if (result.status !== "passed" && step.required && !args.allowPartial) {
      break;
    }
  }

  const artifacts = [
    { id: "live-prereqs", path: args.livePrereqsPath },
    {
      id: "fixtures",
      path: args.fixturesPath,
      maxAgeMs: args.fixturesMaxAgeMinutes * 60 * 1000
    },
    { id: "pilot-flow", path: pilotOutput },
    { id: "staging-checks", path: checksOutput },
    { id: "pilot-kpis", path: kpiOutput }
  ];

  if (!args.skipLiveSmoke) {
    artifacts.push({
      id: "github-smoke",
      path: smokeOutput
    });
  }

  const requiredFailures = results.filter((result) => result.required && result.status === "failed");
  const requiredSkips = results.filter((result) => result.required && result.status === "skipped");
  const optionalFailures = results.filter((result) => !result.required && result.status === "failed");

  const reportMeta = {
    runId: args.runId,
    lane: args.lane,
    gitSha: args.gitSha
  };
  const artifactValidation = validateArtifacts(
    {
      artifacts,
      startedAtMs,
      endedAtMs: Date.now(),
      maxArtifactAgeMs: 45 * 60 * 1000
    },
    reportMeta
  );

  const report = {
    schemaVersion: "1.3.0",
    runId: args.runId,
    lane: args.lane,
    gitSha: args.gitSha,
    generatedAt: new Date().toISOString(),
    outputDir,
    allowPartial: args.allowPartial,
    fixturesPath: args.fixturesPath,
    livePrereqsPath: args.livePrereqsPath,
    steps: results,
    requiredFailures,
    requiredSkips,
    optionalFailures,
    artifacts,
    artifactValidation,
    gateStatus:
      requiredFailures.length === 0 &&
      requiredSkips.length === 0 &&
      artifactValidation.errors.length === 0
        ? "passed"
        : "failed"
  };

  const summaryPath = resolve(outputDir, args.summaryName);
  writeFileSync(summaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const checklistPath = createChecklist(report, outputDir);

  console.log(`[mvp-gate] runId=${args.runId}`);
  console.log(`[mvp-gate] summary: ${summaryPath}`);
  console.log(`[mvp-gate] checklist: ${checklistPath}`);

  if (report.gateStatus !== "passed" && !args.allowPartial) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error("[mvp-gate] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
