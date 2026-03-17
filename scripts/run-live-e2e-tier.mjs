import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

function parseArgs(argv) {
  const read = (prefix) => argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);

  return {
    fixturesPath: resolve(
      process.cwd(),
      read("--fixtures=") ?? "artifacts/live-e2e/fixtures.json"
    ),
    runId:
      read("--runId=") ??
      `live-e2e-${new Date().toISOString().replace(/[.:]/g, "-")}-${randomUUID().slice(0, 8)}`,
    lane: read("--lane=") ?? process.env.BRANCHLINE_CI_LANE ?? "local",
    gitSha: read("--gitSha=") ?? process.env.GITHUB_SHA ?? "unknown",
    playwrightBaseUrl:
      read("--playwrightBaseUrl=") ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000"
  };
}

function run(command, env) {
  const result = spawnSync(command, {
    shell: true,
    cwd: process.cwd(),
    stdio: "inherit",
    env
  });

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? "unknown"}): ${command}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  run(
    `pnpm seed:live:e2e --runId=${args.runId} --lane=${args.lane} --gitSha=${args.gitSha} --output=${args.fixturesPath}`,
    process.env
  );

  const fixtures = JSON.parse(readFileSync(args.fixturesPath, "utf8"));
  const ownerToken = fixtures?.users?.owner?.bearerToken;
  if (!ownerToken) {
    throw new Error("fixtures.users.owner.bearerToken missing after live seed");
  }

  const liveEnv = {
    ...process.env,
    BRANCHLINE_LIVE_FIXTURES: args.fixturesPath,
    BRANCHLINE_E2E_BEARER_TOKEN: ownerToken,
    PLAYWRIGHT_BASE_URL: args.playwrightBaseUrl,
    BRANCHLINE_API_BASE_URL:
      process.env.BRANCHLINE_API_BASE_URL ?? fixtures.apiBaseUrl ?? "http://127.0.0.1:4000/v1"
  };

  run("pnpm e2e:web:live", liveEnv);
  run("pnpm e2e:extension:live", liveEnv);

  console.log(`[live-e2e] completed with fixtures ${args.fixturesPath}`);
}

main().catch((error) => {
  console.error("[live-e2e] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
