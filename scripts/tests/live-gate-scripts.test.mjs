import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(process.cwd());
const nodeBinary = process.execPath;

function runScript(scriptPath, args, env = {}) {
  return spawnSync(nodeBinary, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });
}

test("live prereqs emits normalized artifact envelope", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "branchline-live-prereqs-test-"));
  try {
    const outputPath = join(tempRoot, "live-prereqs.json");
    const result = runScript(
      resolve(repoRoot, "scripts/check-live-prereqs.mjs"),
      [
        "--allow-skip",
        "--lane=local",
        "--runId=test-live-prereqs-run",
        "--gitSha=test-live-prereqs-sha",
        `--output=${outputPath}`
      ],
      {
        AUTH_JWT_SECRET: "",
        GITHUB_WEBHOOK_SECRET: "",
        BRANCHLINE_SMOKE_BEARER_TOKEN: "",
        BRANCHLINE_GITHUB_INSTALLATION_ID: "",
        BRANCHLINE_API_BASE_URL: ""
      }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const payload = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(payload.schemaVersion, "1.1.0");
    assert.equal(payload.runId, "test-live-prereqs-run");
    assert.equal(payload.lane, "local");
    assert.equal(payload.gitSha, "test-live-prereqs-sha");
    assert.equal(typeof payload.contract?.path, "string");
    assert.equal(payload.contract?.schemaVersion, "1.0.0");
    assert.ok(typeof payload.generatedAt === "string" && payload.generatedAt.length > 0);
    assert.ok(Array.isArray(payload.checks));
    assert.ok(Number(payload.summary?.failed) > 0);
  } finally {
    rmSync(tempRoot, {
      recursive: true,
      force: true
    });
  }
});

test("mvp live gate always writes gate summary on early preflight failure", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "branchline-mvp-live-gate-test-"));
  try {
    const runId = "test-mvp-live-gate-run";
    const result = runScript(
      resolve(repoRoot, "scripts/mvp-gate-live.mjs"),
      [
        "--lane=nightly",
        `--runId=${runId}`,
        "--gitSha=test-mvp-live-gate-sha",
        `--outputRoot=${tempRoot}`
      ],
      {
        AUTH_JWT_SECRET: "",
        GITHUB_WEBHOOK_SECRET: "",
        BRANCHLINE_SMOKE_BEARER_TOKEN: "",
        BRANCHLINE_GITHUB_INSTALLATION_ID: "",
        BRANCHLINE_API_BASE_URL: ""
      }
    );

    assert.notEqual(result.status, 0, "expected preflight failure when required live inputs are missing");

    const summaryPath = join(tempRoot, runId, "gate-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    assert.equal(summary.schemaVersion, "1.0.0");
    assert.equal(summary.runId, runId);
    assert.equal(summary.lane, "nightly");
    assert.equal(summary.gitSha, "test-mvp-live-gate-sha");
    assert.equal(summary.gateStatus, "failed");
    assert.ok(Array.isArray(summary.steps) && summary.steps.length >= 1);
    assert.equal(summary.steps[0].id, "static-live-prereqs");
  } finally {
    rmSync(tempRoot, {
      recursive: true,
      force: true
    });
  }
});

test("live prereqs passes strict validation when required contract is provided", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "branchline-live-prereqs-valid-test-"));
  try {
    const outputPath = join(tempRoot, "live-prereqs.json");
    const result = runScript(
      resolve(repoRoot, "scripts/check-live-prereqs.mjs"),
      [
        "--strict",
        "--lane=nightly",
        "--runId=test-live-prereqs-valid-run",
        "--gitSha=test-live-prereqs-valid-sha",
        `--output=${outputPath}`
      ],
      {
        BRANCHLINE_API_BASE_URL: "http://127.0.0.1:4000/v1",
        AUTH_JWT_SECRET: "test-auth-jwt-secret-123456",
        GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
        BRANCHLINE_SMOKE_BEARER_TOKEN: "test-smoke-bearer-token-1234567890",
        BRANCHLINE_GITHUB_INSTALLATION_ID: "123456"
      }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const payload = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(payload.schemaVersion, "1.1.0");
    assert.equal(payload.runId, "test-live-prereqs-valid-run");
    assert.equal(payload.lane, "nightly");
    assert.equal(payload.gitSha, "test-live-prereqs-valid-sha");
    assert.equal(payload.contract?.schemaVersion, "1.0.0");
    assert.equal(payload.summary?.failed, 0);
  } finally {
    rmSync(tempRoot, {
      recursive: true,
      force: true
    });
  }
});

test("mvp staging gate validates artifact stage order", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "branchline-mvp-staging-artifacts-test-"));
  try {
    const runId = "test-mvp-staging-run";
    const lane = "local";
    const gitSha = "test-mvp-staging-sha";
    const generatedAt = new Date(Date.now() + 60_000).toISOString();
    const outputDir = join(tempRoot, "gate-output");
    const fixturesPath = join(tempRoot, "fixtures.json");
    const livePrereqsPath = join(tempRoot, "live-prereqs.json");
    const summaryName = "summary.json";

    mkdirSync(outputDir, { recursive: true });

    const writeJson = (path, value) => {
      writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      const future = new Date(Date.now() + 120_000);
      utimesSync(path, future, future);
    };

    writeJson(fixturesPath, {
      schemaVersion: "1.0.0",
      runId,
      lane,
      gitSha,
      generatedAt,
      apiBaseUrl: "http://127.0.0.1:4000/v1",
      org: { id: "org_test" },
      project: { id: "proj_test" },
      repositories: {
        main: { id: "repo_main" },
        mismatch: { id: "repo_mismatch" }
      },
      users: {
        owner: { bearerToken: "owner_token_1234567890" },
        extension: { bearerToken: "extension_token_1234567890" },
        admin: { bearerToken: "admin_token_1234567890" },
        member: { bearerToken: "member_token_1234567890" },
        viewer: { bearerToken: "viewer_token_1234567890" }
      }
    });

    writeJson(livePrereqsPath, {
      schemaVersion: "1.1.0",
      runId,
      lane,
      gitSha,
      generatedAt,
      checks: [],
      summary: { total: 0, passed: 0, failed: 0 }
    });

    writeJson(join(outputDir, "pilot-flow.json"), {
      schemaVersion: "1.0.0",
      runId,
      lane,
      gitSha,
      generatedAt,
      steps: [
        { id: "repo_linked", status: "passed" },
        { id: "onboarding_scope", status: "passed" },
        { id: "task_start", status: "passed" },
        { id: "guardrail_pre_apply", status: "passed" },
        { id: "branch_create", status: "passed" },
        { id: "conflict_score", status: "passed" },
        { id: "quality_run", status: "passed" },
        { id: "quality_terminal", status: "passed" },
        { id: "promotion_gate", status: "passed" },
        { id: "review_digest", status: "passed" },
        { id: "handoff_create", status: "passed" },
        { id: "handoff_ack", status: "passed" },
        { id: "replay_provenance", status: "passed" }
      ]
    });

    writeJson(join(outputDir, "staging-checks.json"), {
      schemaVersion: "1.0.0",
      runId,
      lane,
      gitSha,
      generatedAt,
      summary: { total: 3, passed: 3, failed: 0 }
    });

    writeJson(join(outputDir, "pilot-kpis.json"), {
      schemaVersion: "1.0.0",
      runId,
      lane,
      gitSha,
      generatedAt,
      metrics: {
        totalTasks: 2,
        tasksWithConflict: 1,
        conflictRate: 0.5,
        averageReviewMinutes: 20,
        averageBaselineReviewMinutes: 25,
        reviewTimeDeltaMinutes: -5,
        reviewTimeDeltaPercent: -20
      }
    });

    const result = runScript(resolve(repoRoot, "scripts/mvp-gate-staging.mjs"), [
      "--allow-partial",
      "--skip-static-live-prereqs",
      "--skip-feature-gates",
      "--skip-fixture-bootstrap",
      "--skip-live-prereq-probe",
      "--skip-live-web-e2e",
      "--skip-live-extension-e2e",
      "--skip-live-smoke",
      "--skip-pilot-flow",
      "--skip-staging-checks",
      "--skip-pilot-kpis",
      `--runId=${runId}`,
      `--lane=${lane}`,
      `--gitSha=${gitSha}`,
      `--outputDir=${outputDir}`,
      `--summaryName=${summaryName}`,
      `--fixtures=${fixturesPath}`,
      `--live-prereqs=${livePrereqsPath}`
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const summaryPath = join(outputDir, summaryName);
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    assert.equal(summary.gateStatus, "failed");
    assert.ok(
      summary.artifactValidation.errors.some((error) =>
        String(error).startsWith("pilot_flow_stage_transition_mismatch:")
      ),
      `expected stage order mismatch in ${JSON.stringify(summary.artifactValidation.errors)}`
    );
  } finally {
    rmSync(tempRoot, {
      recursive: true,
      force: true
    });
  }
});

test("mvp live gate rejects allow-partial in strict lanes", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "branchline-mvp-live-gate-strict-test-"));
  try {
    const result = runScript(
      resolve(repoRoot, "scripts/mvp-gate-live.mjs"),
      ["--lane=nightly", "--allow-partial", `--outputRoot=${tempRoot}`],
      {
        AUTH_JWT_SECRET: "",
        GITHUB_WEBHOOK_SECRET: "",
        BRANCHLINE_SMOKE_BEARER_TOKEN: "",
        BRANCHLINE_GITHUB_INSTALLATION_ID: "",
        BRANCHLINE_API_BASE_URL: ""
      }
    );

    assert.notEqual(result.status, 0, "expected strict-lane allow-partial rejection");
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.match(output, /--allow-partial is not permitted for strict lanes/);
  } finally {
    rmSync(tempRoot, {
      recursive: true,
      force: true
    });
  }
});

test("mvp staging gate rejects required-step skip flags in strict lanes", () => {
  const result = runScript(resolve(repoRoot, "scripts/mvp-gate-staging.mjs"), [
    "--lane=nightly",
    "--skip-feature-gates"
  ]);

  assert.notEqual(result.status, 0, "expected strict-lane skip flag rejection");
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.match(output, /strict lanes do not permit required-step skip flags/);
});

test("mvp signoff iteration writes index/checklist on early strict failure", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "branchline-mvp-signoff-iteration-test-"));
  try {
    const iterationId = "test-mvp-signoff-iteration";
    const outputRoot = join(tempRoot, "signoff");
    const gateOutputRoot = join(tempRoot, "gates");
    const result = runScript(
      resolve(repoRoot, "scripts/run-mvp-signoff-iteration.mjs"),
      [
        `--iterationId=${iterationId}`,
        "--nightlyRuns=1",
        "--skip-rc",
        "--skip-pilot",
        `--outputRoot=${outputRoot}`,
        `--gateOutputRoot=${gateOutputRoot}`
      ],
      {
        AUTH_JWT_SECRET: "",
        GITHUB_WEBHOOK_SECRET: "",
        BRANCHLINE_SMOKE_BEARER_TOKEN: "",
        BRANCHLINE_GITHUB_INSTALLATION_ID: "",
        BRANCHLINE_API_BASE_URL: ""
      }
    );

    assert.notEqual(result.status, 0, "expected iteration to fail without strict live inputs");

    const indexPath = join(outputRoot, iterationId, "mvp-signoff-index.json");
    const checklistPath = join(outputRoot, iterationId, "mvp-signoff-checklist.md");
    const bundlePath = join(outputRoot, iterationId, "release-signoff-bundle.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

    assert.equal(index.iterationId, iterationId);
    assert.equal(index.summary.strictMvpSignoff, false);
    assert.equal(index.summary.evidenceIntegrityPassed, false);
    assert.ok(Array.isArray(index.requiredStatuses) && index.requiredStatuses.length === 4);
    assert.equal(typeof index.releaseSignoffBundlePath, "string");
    assert.equal(bundle.iterationId, iterationId);
    assert.ok(Array.isArray(bundle.requiredStatuses) && bundle.requiredStatuses.length === 4);
    assert.ok(Array.isArray(bundle.evidenceValidation) && bundle.evidenceValidation.length >= 1);
    assert.ok(Array.isArray(index.runs) && index.runs.length >= 1);
    assert.equal(index.runs[0].id, "nightly-1");
    assert.equal(index.runs[0].status, "failed");
    assert.ok(readFileSync(checklistPath, "utf8").includes("MVP Signoff Iteration Checklist"));
  } finally {
    rmSync(tempRoot, {
      recursive: true,
      force: true
    });
  }
});

test("mvp signoff iteration rejects skip flags in strict mode", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "branchline-mvp-signoff-strict-skip-test-"));
  try {
    const result = runScript(resolve(repoRoot, "scripts/run-mvp-signoff-iteration.mjs"), [
      "--strict",
      "--skip-rc",
      `--outputRoot=${join(tempRoot, "signoff")}`,
      `--gateOutputRoot=${join(tempRoot, "gates")}`
    ]);

    assert.notEqual(result.status, 0, "expected strict-mode skip flag rejection");
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.match(output, /--skip-rc\/--skip-pilot are not permitted in strict mode/);
  } finally {
    rmSync(tempRoot, {
      recursive: true,
      force: true
    });
  }
});

test("mvp signoff iteration enforces nightlyRuns in strict mode", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "branchline-mvp-signoff-strict-runs-test-"));
  try {
    const result = runScript(resolve(repoRoot, "scripts/run-mvp-signoff-iteration.mjs"), [
      "--strict",
      "--nightlyRuns=2",
      `--outputRoot=${join(tempRoot, "signoff")}`,
      `--gateOutputRoot=${join(tempRoot, "gates")}`
    ]);

    assert.notEqual(result.status, 0, "expected strict-mode nightlyRuns validation failure");
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.match(output, /--nightlyRuns must be at least 3 in strict mode/);
  } finally {
    rmSync(tempRoot, {
      recursive: true,
      force: true
    });
  }
});

test("mvp signoff iteration requires gitSha in strict mode when git metadata is unavailable", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "branchline-mvp-signoff-strict-git-sha-test-"));
  try {
    const result = runScript(
      resolve(repoRoot, "scripts/run-mvp-signoff-iteration.mjs"),
      [
        "--strict",
        `--outputRoot=${join(tempRoot, "signoff")}`,
        `--gateOutputRoot=${join(tempRoot, "gates")}`
      ],
      {
        GITHUB_SHA: "",
        PATH: ""
      }
    );

    assert.notEqual(result.status, 0, "expected strict-mode git SHA validation failure");
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.match(output, /--gitSha is required in strict mode when git metadata is unavailable/);
  } finally {
    rmSync(tempRoot, {
      recursive: true,
      force: true
    });
  }
});
