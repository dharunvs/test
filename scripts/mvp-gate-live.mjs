import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const DEFAULT_CONTRACT_PATH = resolve(
  process.cwd(),
  "docs/04_delivery/04_live_input_contract.json"
);

function parseArgs(argv) {
  const read = (prefix) => argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);

  const lane = read("--lane=") ?? process.env.BRANCHLINE_CI_LANE ?? "local";
  const runId =
    read("--runId=") ??
    `mvp-live-gate-${new Date().toISOString().replace(/[.:]/g, "-")}-${randomUUID().slice(0, 8)}`;

  return {
    lane,
    runId,
    gitSha: read("--gitSha=") ?? resolveGitSha(),
    outputRoot: resolve(process.cwd(), read("--outputRoot=") ?? "artifacts/mvp-gate"),
    fixturesPath: resolve(
      process.cwd(),
      read("--fixtures=") ?? "artifacts/live-e2e/fixtures.json"
    ),
    contractPath: resolve(
      process.cwd(),
      read("--contract=") ?? process.env.BRANCHLINE_LIVE_CONTRACT_PATH ?? DEFAULT_CONTRACT_PATH
    ),
    playwrightBaseUrl:
      read("--playwrightBaseUrl=") ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    skipFeatureGates: argv.includes("--skip-feature-gates"),
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

function runStep(step, outputDir, env) {
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

function createChecklist(report, outputDir) {
  const lines = [
    "# MVP Live Gate Checklist",
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
    ...report.artifacts.map(
      (artifact) => `- ${artifact.id}: ${artifact.path} (${artifact.exists ? "present" : "missing"})`
    ),
    "",
    "## Overall",
    `- Gate status: ${report.gateStatus}`,
    `- Required failures: ${report.requiredFailures.length}`
  ];

  const checklistPath = resolve(outputDir, "release-checklist.md");
  writeFileSync(checklistPath, `${lines.join("\n")}\n`, "utf8");
  return checklistPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const strictLane = args.lane === "nightly" || args.lane === "rc";
  if (strictLane && args.allowPartial) {
    throw new Error("--allow-partial is not permitted for strict lanes (nightly/rc)");
  }
  if (strictLane && args.skipFeatureGates) {
    throw new Error("--skip-feature-gates is not permitted for strict lanes (nightly/rc)");
  }

  const outputDir = resolve(args.outputRoot, args.runId);
  ensureDir(outputDir);

  const livePrereqsPath = resolve(outputDir, "live-prereqs.json");
  const stagingSummaryPath = resolve(outputDir, "staging-gate-summary.json");

  const env = {
    ...process.env,
    BRANCHLINE_CI_LANE: args.lane,
    BRANCHLINE_GATE_RUN_ID: args.runId,
    BRANCHLINE_LIVE_CONTRACT_PATH: args.contractPath,
    BRANCHLINE_STRICT_ORCHESTRATED: "1",
    PLAYWRIGHT_BASE_URL: args.playwrightBaseUrl
  };
  if (!env.BRANCHLINE_E2E_BEARER_TOKEN && env.BRANCHLINE_SMOKE_BEARER_TOKEN) {
    env.BRANCHLINE_E2E_BEARER_TOKEN = env.BRANCHLINE_SMOKE_BEARER_TOKEN;
  }

  const steps = [
    {
      id: "static-live-prereqs",
      command: `pnpm live:preflight --strict --lane=${args.lane} --runId=${args.runId} --gitSha=${args.gitSha} --contract=${args.contractPath} --output=${livePrereqsPath}`,
      required: true
    },
    {
      id: "full-stack-strict-gate",
      command: `pnpm full-stack:harness --run="pnpm mvp:gate:staging --outputDir=${outputDir} --summaryName=staging-gate-summary.json --fixtures=${args.fixturesPath} --live-prereqs=${livePrereqsPath} --skip-static-live-prereqs --lane=${args.lane} --runId=${args.runId} --gitSha=${args.gitSha}${args.skipFeatureGates ? " --skip-feature-gates" : ""}"`,
      required: true
    }
  ];

  const results = [];
  for (const step of steps) {
    const result = runStep(step, outputDir, env);
    results.push(result);
    if (result.status !== "passed" && step.required && !args.allowPartial) {
      break;
    }
  }

  let stagingSummary = null;
  if (existsSync(stagingSummaryPath)) {
    try {
      stagingSummary = JSON.parse(readFileSync(stagingSummaryPath, "utf8"));
    } catch {
      stagingSummary = null;
    }
  }

  const artifactPaths = [
    { id: "live-prereqs", path: livePrereqsPath },
    { id: "fixtures", path: args.fixturesPath },
    { id: "pilot-flow", path: resolve(outputDir, "pilot-flow.json") },
    { id: "staging-checks", path: resolve(outputDir, "staging-checks.json") },
    { id: "pilot-kpis", path: resolve(outputDir, "pilot-kpis.json") },
    { id: "github-sandbox-smoke", path: resolve(outputDir, "github-sandbox-smoke.json") },
    { id: "staging-gate-summary", path: stagingSummaryPath }
  ];
  const artifacts = artifactPaths.map((artifact) => ({
    ...artifact,
    exists: existsSync(artifact.path)
  }));

  const requiredFailures = results.filter((result) => result.required && result.status !== "passed");
  const missingArtifacts = artifacts.filter((artifact) => artifact.exists !== true);
  const stagingGateFailed =
    stagingSummary?.gateStatus && stagingSummary.gateStatus !== "passed"
      ? ["staging_gate_failed"]
      : [];
  const gateStatus =
    requiredFailures.length === 0 && missingArtifacts.length === 0 && stagingGateFailed.length === 0
      ? "passed"
      : "failed";

  const summary = {
    schemaVersion: "1.0.0",
    runId: args.runId,
    lane: args.lane,
    gitSha: args.gitSha,
    generatedAt: new Date().toISOString(),
    outputDir,
    steps: results,
    requiredFailures,
    artifacts,
    validationErrors: [
      ...missingArtifacts.map((artifact) => `missing_artifact:${artifact.id}`),
      ...stagingGateFailed
    ],
    stagingSummaryPath,
    gateStatus
  };

  const summaryPath = resolve(outputDir, "gate-summary.json");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  const checklistPath = createChecklist(summary, outputDir);

  console.log(`[mvp-live-gate] runId=${args.runId}`);
  console.log(`[mvp-live-gate] summary: ${summaryPath}`);
  console.log(`[mvp-live-gate] checklist: ${checklistPath}`);

  if (summary.gateStatus !== "passed" && !args.allowPartial) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error("[mvp-live-gate] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
