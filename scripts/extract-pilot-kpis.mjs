import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const output = argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
  const input = argv.find((arg) => arg.startsWith("--input="))?.slice("--input=".length);
  const allowEmpty = argv.includes("--allow-empty");
  const runId = argv.find((arg) => arg.startsWith("--runId="))?.slice("--runId=".length);
  const lane =
    argv.find((arg) => arg.startsWith("--lane="))?.slice("--lane=".length) ??
    process.env.BRANCHLINE_CI_LANE ??
    "local";
  const gitSha = argv.find((arg) => arg.startsWith("--gitSha="))?.slice("--gitSha=".length);

  return {
    input: resolve(process.cwd(), input ?? "artifacts/pilot/pilot-observations.json"),
    output: resolve(process.cwd(), output ?? "artifacts/pilot/pilot-kpis.json"),
    allowEmpty,
    runId:
      runId ??
      `pilot-kpi-${new Date().toISOString().replace(/[.:]/g, "-")}-${randomUUID().slice(0, 8)}`,
    lane,
    gitSha: gitSha ?? resolveGitSha()
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

function safeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function calculateMetrics(rows) {
  const total = rows.length;
  if (total === 0) {
    return {
      totalTasks: 0,
      tasksWithConflict: 0,
      conflictRate: 0,
      averageReviewMinutes: 0,
      averageBaselineReviewMinutes: 0,
      reviewTimeDeltaMinutes: 0,
      reviewTimeDeltaPercent: 0
    };
  }

  const tasksWithConflict = rows.filter((row) => safeNumber(row.conflictCount) > 0).length;
  const totalReview = rows.reduce((sum, row) => sum + safeNumber(row.reviewMinutes), 0);
  const totalBaseline = rows.reduce((sum, row) => sum + safeNumber(row.baselineReviewMinutes), 0);
  const averageReviewMinutes = totalReview / total;
  const averageBaselineReviewMinutes = totalBaseline / total;
  const reviewTimeDeltaMinutes = averageReviewMinutes - averageBaselineReviewMinutes;
  const reviewTimeDeltaPercent =
    averageBaselineReviewMinutes > 0
      ? (reviewTimeDeltaMinutes / averageBaselineReviewMinutes) * 100
      : 0;

  return {
    totalTasks: total,
    tasksWithConflict,
    conflictRate: tasksWithConflict / total,
    averageReviewMinutes,
    averageBaselineReviewMinutes,
    reviewTimeDeltaMinutes,
    reviewTimeDeltaPercent
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let rows = [];
  let note = "";

  if (existsSync(args.input)) {
    const parsed = JSON.parse(readFileSync(args.input, "utf8"));
    rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.tasks)
        ? parsed.tasks
        : Array.isArray(parsed?.observations)
          ? parsed.observations
          : [];
  } else if (!args.allowEmpty) {
    throw new Error(`Input file not found: ${args.input}`);
  } else {
    note = `Input file not found: ${args.input}`;
  }

  const metrics = calculateMetrics(rows);
  const report = {
    schemaVersion: "1.0.0",
    runId: args.runId,
    lane: args.lane,
    gitSha: args.gitSha,
    generatedAt: new Date().toISOString(),
    inputPath: args.input,
    note,
    metrics
  };

  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[pilot-kpi] wrote ${args.output}`);
}

try {
  main();
} catch (error) {
  console.error("[pilot-kpi] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
