import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const DEFAULT_CONTRACT_PATH = resolve(
  process.cwd(),
  "docs/04_delivery/04_live_input_contract.json"
);
const REQUIRED_RELEASE_STATUSES = [
  "checks",
  "e2e_web",
  "e2e_extension",
  "live_stack_provider_smoke"
];
const REQUIRED_GATE_ARTIFACT_IDS = [
  "live-prereqs",
  "fixtures",
  "pilot-flow",
  "staging-checks",
  "pilot-kpis",
  "github-sandbox-smoke",
  "staging-gate-summary"
];

function parseArgs(argv) {
  const read = (prefix) => argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const strict = argv.includes("--strict");

  return {
    strict,
    iterationId:
      read("--iterationId=") ??
      `mvp-signoff-${new Date().toISOString().replace(/[.:]/g, "-")}-${randomUUID().slice(0, 8)}`,
    outputRoot: resolve(process.cwd(), read("--outputRoot=") ?? "artifacts/mvp-signoff"),
    gateOutputRoot: resolve(process.cwd(), read("--gateOutputRoot=") ?? "artifacts/mvp-gate-signoff"),
    nightlyRuns: Number(read("--nightlyRuns=") ?? 3),
    skipRc: argv.includes("--skip-rc"),
    skipPilot: argv.includes("--skip-pilot"),
    continueOnFailure: argv.includes("--continue-on-failure"),
    allowFailure: argv.includes("--allow-failure"),
    gitSha: read("--gitSha=") ?? resolveGitSha(),
    contractPath: resolve(
      process.cwd(),
      read("--contract=") ?? process.env.BRANCHLINE_LIVE_CONTRACT_PATH ?? DEFAULT_CONTRACT_PATH
    ),
    playwrightBaseUrl: read("--playwrightBaseUrl=") ?? process.env.PLAYWRIGHT_BASE_URL ?? ""
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
  mkdirSync(path, { recursive: true });
}

function parseJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function runCommand(step, command, outputDir) {
  const startedAt = new Date();
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      BRANCHLINE_CI_LANE: step.lane
    }
  });

  const endedAt = new Date();
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const logPath = resolve(outputDir, `${step.id}.log`);
  writeFileSync(logPath, output, "utf8");

  if (output.trim().length > 0) {
    process.stdout.write(output);
  }

  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    exitCode: result.status ?? 1,
    logPath
  };
}

function loadGateSummary(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return parseJson(path);
  } catch {
    return null;
  }
}

function validateRunEvidence(run) {
  if (!run.summary || run.status === "not_run") {
    return {
      ok: false,
      errors: ["gate_summary_missing_or_not_run"],
      artifacts: []
    };
  }

  const summary = run.summary;
  const errors = [];
  const artifacts = [];

  if (summary.gateStatus !== "passed") {
    errors.push(`gate_status_not_passed:${summary.gateStatus ?? "missing"}`);
  }

  if (!Array.isArray(summary.artifacts)) {
    errors.push("gate_summary_artifacts_missing");
  }

  const summaryArtifacts = Array.isArray(summary.artifacts) ? summary.artifacts : [];
  for (const artifactId of REQUIRED_GATE_ARTIFACT_IDS) {
    const declared = summaryArtifacts.find((artifact) => artifact?.id === artifactId);
    if (!declared || typeof declared?.path !== "string") {
      errors.push(`required_artifact_not_declared:${artifactId}`);
      continue;
    }

    const exists = existsSync(declared.path);
    if (declared.exists !== true || !exists) {
      errors.push(`required_artifact_missing:${artifactId}`);
    }

    artifacts.push({
      id: artifactId,
      path: declared.path,
      exists
    });
  }

  const checklistPath = resolve(summary.outputDir ?? resolve(process.cwd(), "artifacts"), "release-checklist.md");
  const checklistExists = existsSync(checklistPath);
  if (!checklistExists) {
    errors.push("required_artifact_missing:release-checklist");
  }
  artifacts.push({
    id: "release-checklist",
    path: checklistPath,
    exists: checklistExists
  });

  const stagingSummaryPath = summary.stagingSummaryPath;
  if (!stagingSummaryPath || !existsSync(stagingSummaryPath)) {
    errors.push("staging_summary_missing");
  } else {
    try {
      const stagingSummary = parseJson(stagingSummaryPath);
      if (stagingSummary?.gateStatus !== "passed") {
        errors.push(`staging_summary_gate_status_not_passed:${stagingSummary?.gateStatus ?? "missing"}`);
      }
      const artifactValidationErrors = Array.isArray(stagingSummary?.artifactValidation?.errors)
        ? stagingSummary.artifactValidation.errors
        : [];
      if (artifactValidationErrors.length > 0) {
        errors.push(`staging_summary_artifact_validation_errors:${artifactValidationErrors.length}`);
      }
    } catch {
      errors.push("staging_summary_invalid_json");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    artifacts
  };
}

function makeChecklist(report, outputDir) {
  const lines = [
    "# MVP Signoff Iteration Checklist",
    "",
    `Iteration ID: ${report.iterationId}`,
    `Git SHA: ${report.gitSha}`,
    `Generated at: ${report.generatedAt}`,
    "",
    "## Release Status Requirements",
    ...REQUIRED_RELEASE_STATUSES.map((status) => `- ${status}`),
    "",
    "## Run Matrix",
    ...report.runs.map(
      (run) =>
        `- ${run.id}: lane=${run.lane} status=${run.status} gateStatus=${run.gateStatus ?? "missing"} summary=${run.summaryPath}`
    ),
    "",
    "## Evidence Integrity",
    `- Evidence integrity passed: ${report.summary.evidenceIntegrityPassed ? "PASS" : "FAIL"}`,
    `- Release signoff bundle: ${report.releaseSignoffBundlePath}`,
    "",
    "## Strict Acceptance",
    `- Nightly consecutive greens (${report.policy.nightlyRuns}): ${report.summary.nightlyConsecutiveGreens ? "PASS" : "FAIL"}`,
    `- RC green: ${report.summary.rcGreen ? "PASS" : "FAIL"}`,
    `- Partner-like pilot green: ${report.summary.partnerPilotGreen ? "PASS" : "FAIL"}`,
    `- Overall strict MVP signoff: ${report.summary.strictMvpSignoff ? "PASS" : "FAIL"}`
  ];

  const checklistPath = resolve(outputDir, "mvp-signoff-checklist.md");
  writeFileSync(checklistPath, `${lines.join("\n")}\n`, "utf8");
  return checklistPath;
}

function buildRunPlan(args) {
  if (!Number.isInteger(args.nightlyRuns) || args.nightlyRuns < 1) {
    throw new Error("--nightlyRuns must be a positive integer");
  }

  const runs = [];
  for (let i = 1; i <= args.nightlyRuns; i += 1) {
    runs.push({
      id: `nightly-${i}`,
      lane: "nightly",
      required: true
    });
  }

  if (!args.skipRc) {
    runs.push({
      id: "rc-1",
      lane: "rc",
      required: true
    });
  }

  if (!args.skipPilot) {
    runs.push({
      id: "partner-pilot",
      lane: "nightly",
      required: true
    });
  }

  return runs;
}

function runIteration(args) {
  if (args.strict) {
    if (args.skipRc || args.skipPilot) {
      throw new Error("--skip-rc/--skip-pilot are not permitted in strict mode");
    }
    if (args.continueOnFailure || args.allowFailure) {
      throw new Error("--continue-on-failure/--allow-failure are not permitted in strict mode");
    }
    if (args.nightlyRuns < 3) {
      throw new Error("--nightlyRuns must be at least 3 in strict mode");
    }
    if (args.gitSha === "unknown") {
      throw new Error("--gitSha is required in strict mode when git metadata is unavailable");
    }
  }

  const outputDir = resolve(args.outputRoot, args.iterationId);
  ensureDir(outputDir);
  ensureDir(args.gateOutputRoot);

  const plan = buildRunPlan(args);
  const results = [];
  let shouldStop = false;

  for (const step of plan) {
    if (shouldStop) {
      results.push({
        id: step.id,
        lane: step.lane,
        required: step.required,
        status: "not_run",
        gateStatus: null,
        summaryPath: "",
      runId: "",
      summary: null,
      logPath: "",
      exitCode: null
    });
      continue;
    }

    const runId = `${args.iterationId}-${step.id}`;
    const summaryPath = resolve(args.gateOutputRoot, runId, "gate-summary.json");
    let command = `pnpm mvp:gate:live --lane=${step.lane} --runId=${runId} --gitSha=${args.gitSha} --outputRoot=${args.gateOutputRoot} --contract=${args.contractPath}`;
    if (args.playwrightBaseUrl.trim().length > 0) {
      command += ` --playwrightBaseUrl=${args.playwrightBaseUrl}`;
    }

    const execution = runCommand(step, command, outputDir);
    const summary = loadGateSummary(summaryPath);
    const gateStatus = summary?.gateStatus ?? null;
    const status =
      execution.exitCode === 0 && gateStatus === "passed" ? "passed" : "failed";

    results.push({
      id: step.id,
      lane: step.lane,
      required: step.required,
      status,
      gateStatus,
      summaryPath,
      runId,
      summary,
      logPath: execution.logPath,
      exitCode: execution.exitCode,
      startedAt: execution.startedAt,
      endedAt: execution.endedAt,
      durationMs: execution.durationMs
    });

    if (status !== "passed" && !args.continueOnFailure) {
      shouldStop = true;
    }
  }

  const nightly = results.filter((run) => run.id.startsWith("nightly-"));
  const rc = results.find((run) => run.id === "rc-1");
  const partnerPilot = results.find((run) => run.id === "partner-pilot");
  const executedRuns = results.filter((run) => run.status !== "not_run");
  const evidenceValidation = executedRuns.map((run) => ({
    runId: run.runId,
    id: run.id,
    lane: run.lane,
    ...validateRunEvidence(run)
  }));
  const evidenceIntegrityPassed =
    evidenceValidation.length > 0 && evidenceValidation.every((entry) => entry.ok === true);

  const nightlyConsecutiveGreens =
    nightly.length === args.nightlyRuns && nightly.every((run) => run.status === "passed");
  const rcGreen = args.skipRc ? true : rc?.status === "passed";
  const partnerPilotGreen = args.skipPilot ? true : partnerPilot?.status === "passed";
  const strictMvpSignoff =
    nightlyConsecutiveGreens && rcGreen && partnerPilotGreen && evidenceIntegrityPassed;

  const releaseSignoffBundle = {
    schemaVersion: "1.0.0",
    iterationId: args.iterationId,
    gitSha: args.gitSha,
    generatedAt: new Date().toISOString(),
    requiredStatuses: REQUIRED_RELEASE_STATUSES,
    runIds: executedRuns.map((run) => run.runId),
    evidenceValidation
  };
  const releaseSignoffBundlePath = resolve(outputDir, "release-signoff-bundle.json");
  writeFileSync(releaseSignoffBundlePath, `${JSON.stringify(releaseSignoffBundle, null, 2)}\n`, "utf8");

  const report = {
    schemaVersion: "1.0.0",
    iterationId: args.iterationId,
    gitSha: args.gitSha,
    generatedAt: new Date().toISOString(),
    policy: {
      nightlyRuns: args.nightlyRuns,
      rcRequired: !args.skipRc,
      partnerPilotRequired: !args.skipPilot
    },
    requiredStatuses: REQUIRED_RELEASE_STATUSES,
    runs: results.map((run) => {
      const { summary: _summary, ...rest } = run;
      return rest;
    }),
    evidenceValidation,
    releaseSignoffBundlePath,
    summary: {
      nightlyConsecutiveGreens,
      rcGreen,
      partnerPilotGreen,
      evidenceIntegrityPassed,
      strictMvpSignoff
    }
  };

  const reportPath = resolve(outputDir, "mvp-signoff-index.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const checklistPath = makeChecklist(report, outputDir);

  console.log(`[mvp-signoff] iteration=${args.iterationId}`);
  console.log(`[mvp-signoff] report: ${reportPath}`);
  console.log(`[mvp-signoff] checklist: ${checklistPath}`);

  if (!strictMvpSignoff && !args.allowFailure) {
    process.exit(1);
  }
}

try {
  runIteration(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error("[mvp-signoff] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
