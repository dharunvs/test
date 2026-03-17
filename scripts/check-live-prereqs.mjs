import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const DEFAULT_CONTRACT_PATH = resolve(
  process.cwd(),
  "docs/04_delivery/04_live_input_contract.json"
);

function parseArgs(argv) {
  const read = (prefix) => argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);

  const lane = read("--lane=") ?? process.env.BRANCHLINE_CI_LANE ?? "local";
  const strict = argv.includes("--strict") || lane === "nightly" || lane === "rc";

  return {
    lane,
    strict,
    runId: read("--runId=") ?? `live-prereqs-${new Date().toISOString().replace(/[.:]/g, "-")}-${randomUUID().slice(0, 8)}`,
    gitSha: read("--gitSha=") ?? resolveGitSha(),
    allowSkip: argv.includes("--allow-skip"),
    probeApi: argv.includes("--probe-api"),
    probeGithubStatus: argv.includes("--probe-github-status"),
    fixturesPath: resolve(
      process.cwd(),
      read("--fixtures=") ?? process.env.BRANCHLINE_LIVE_FIXTURES ?? "artifacts/live-e2e/fixtures.json"
    ),
    contractPath: resolve(
      process.cwd(),
      read("--contract=") ?? process.env.BRANCHLINE_LIVE_CONTRACT_PATH ?? DEFAULT_CONTRACT_PATH
    ),
    outputPath: resolve(
      process.cwd(),
      read("--output=") ?? "artifacts/live-e2e/live-prereqs.json"
    )
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

function pushCheck(checks, input) {
  checks.push({
    name: input.name,
    required: input.required,
    ok: input.ok,
    message: input.message ?? "",
    details: input.details ?? null,
    at: new Date().toISOString()
  });
}

function parseContract(path) {
  if (!existsSync(path)) {
    throw new Error(`live prerequisite contract not found: ${path}`);
  }

  const payload = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(payload?.requiredChecks) || payload.requiredChecks.length === 0) {
    throw new Error(`live prerequisite contract invalid: requiredChecks missing in ${path}`);
  }

  return payload;
}

function resolveEnvValue(envKeys, env) {
  for (const key of envKeys) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return {
        key,
        value
      };
    }
  }

  return {
    key: null,
    value: ""
  };
}

function validateApiBaseUrl(rawValue, missingMessage) {
  if (!rawValue) {
    return { ok: false, message: missingMessage };
  }

  try {
    const parsed = new URL(rawValue);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, message: "api base url must use http/https protocol" };
    }
  } catch {
    return { ok: false, message: "api base url is not a valid URL" };
  }

  return { ok: true };
}

function validateJwtSecret(rawValue, missingMessage) {
  if (!rawValue) {
    return { ok: false, message: missingMessage };
  }

  if (rawValue.length < 16) {
    return { ok: false, message: "AUTH_JWT_SECRET must be at least 16 characters" };
  }

  if (rawValue === "branchline-dev-auth-secret") {
    return { ok: false, message: "AUTH_JWT_SECRET must not use local default value" };
  }

  return { ok: true };
}

function validateMinLength(rawValue, missingMessage, minLength, fieldName) {
  if (!rawValue) {
    return { ok: false, message: missingMessage };
  }

  if (rawValue.length < minLength) {
    return { ok: false, message: `${fieldName} must be at least ${minLength} characters` };
  }

  return { ok: true };
}

function validatePositiveInteger(rawValue, missingMessage, fieldName) {
  if (!rawValue) {
    return { ok: false, message: missingMessage };
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, message: `${fieldName} must be a positive integer` };
  }

  return { ok: true };
}

function validateContractRule(input) {
  const missingMessage = input.missingMessage ?? `missing ${input.env.join("/")}`;
  switch (input.rule) {
    case "url_http_https":
      return validateApiBaseUrl(input.value, missingMessage);
    case "jwt_secret_strict":
      return validateJwtSecret(input.value, missingMessage);
    case "min_length_8":
      return validateMinLength(input.value, missingMessage, 8, input.env[0] ?? input.name);
    case "min_length_20":
      return validateMinLength(input.value, missingMessage, 20, input.env[0] ?? input.name);
    case "positive_integer":
      return validatePositiveInteger(input.value, missingMessage, input.env[0] ?? input.name);
    default:
      return {
        ok: false,
        message: `unsupported contract rule '${input.rule}' for ${input.name}`
      };
  }
}

function runContractChecks(contract, env) {
  const checks = [];

  for (const entry of contract.requiredChecks) {
    const envKeys = Array.isArray(entry?.env) ? entry.env : [];
    if (!entry?.name || envKeys.length === 0 || typeof entry?.rule !== "string") {
      throw new Error(`invalid contract entry: ${JSON.stringify(entry)}`);
    }

    const resolved = resolveEnvValue(envKeys, env);
    const result = validateContractRule({
      name: entry.name,
      env: envKeys,
      rule: entry.rule,
      value: resolved.value,
      missingMessage: entry.missingMessage
    });

    pushCheck(checks, {
      name: entry.name,
      required: true,
      ok: result.ok,
      message: result.message,
      details: {
        envKeys,
        resolvedEnv: resolved.key
      }
    });
  }

  return checks;
}

function readFixtures(path) {
  if (!existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

async function fetchJson(input) {
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
  const body = text.length > 0 ? JSON.parse(text) : {};
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body
  };
}

async function runProbes(input) {
  const checks = [];
  const fixtures = readFixtures(input.fixturesPath);
  const apiBaseUrl =
    process.env.BRANCHLINE_STAGING_API_BASE_URL ??
    process.env.BRANCHLINE_API_BASE_URL ??
    fixtures?.apiBaseUrl;
  const smokeToken =
    process.env.BRANCHLINE_SMOKE_BEARER_TOKEN ?? fixtures?.users?.owner?.bearerToken;
  const orgId = process.env.BRANCHLINE_LIVE_ORG_ID ?? fixtures?.org?.id;
  const projectId = process.env.BRANCHLINE_LIVE_PROJECT_ID ?? fixtures?.project?.id;

  if (input.probeApi) {
    if (!apiBaseUrl || !smokeToken) {
      pushCheck(checks, {
        name: "api_auth_probe",
        required: true,
        ok: false,
        message: "api auth probe requires API base URL and smoke bearer token"
      });
    } else {
      try {
        const me = await fetchJson({
          baseUrl: apiBaseUrl,
          path: "/auth/me",
          token: smokeToken
        });
        pushCheck(checks, {
          name: "api_auth_probe",
          required: true,
          ok: me.ok,
          message: me.ok ? "auth probe succeeded" : `auth probe failed (${me.status})`,
          details: {
            status: me.status
          }
        });
      } catch (error) {
        pushCheck(checks, {
          name: "api_auth_probe",
          required: true,
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  if (input.probeGithubStatus) {
    if (!apiBaseUrl || !smokeToken || !orgId || !projectId) {
      pushCheck(checks, {
        name: "github_status_probe",
        required: true,
        ok: false,
        message: "github status probe requires api URL, smoke token, orgId, and projectId"
      });
    } else {
      try {
        const status = await fetchJson({
          baseUrl: apiBaseUrl,
          path: `/github/installations/status?orgId=${encodeURIComponent(orgId)}&projectId=${encodeURIComponent(projectId)}`,
          token: smokeToken
        });

        const installations = Array.isArray(status.body?.installations)
          ? status.body.installations.length
          : 0;
        const repositories = Array.isArray(status.body?.repositories)
          ? status.body.repositories.length
          : 0;

        pushCheck(checks, {
          name: "github_status_probe",
          required: true,
          ok: status.ok && (installations > 0 || repositories > 0),
          message: status.ok ? "github status probe returned mapped state" : `status probe failed (${status.status})`,
          details: {
            status: status.status,
            installations,
            repositories
          }
        });
      } catch (error) {
        pushCheck(checks, {
          name: "github_status_probe",
          required: true,
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  return checks;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const contract = parseContract(args.contractPath);
  const env = process.env;
  const checks = runContractChecks(contract, env);

  const probeChecks = await runProbes({
    probeApi: args.probeApi,
    probeGithubStatus: args.probeGithubStatus,
    fixturesPath: args.fixturesPath
  });
  checks.push(...probeChecks);

  const failedChecks = checks.filter((check) => check.required && check.ok !== true);
  const report = {
    schemaVersion: "1.1.0",
    runId: args.runId,
    lane: args.lane,
    gitSha: args.gitSha,
    strict: args.strict,
    contract: {
      path: args.contractPath,
      schemaVersion: contract.schemaVersion ?? null
    },
    generatedAt: new Date().toISOString(),
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failedChecks.length,
      failed: failedChecks.length
    }
  };

  mkdirSync(dirname(args.outputPath), { recursive: true });
  writeFileSync(args.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (failedChecks.length === 0) {
    console.log(`[live-prereqs] passed (${args.lane}) -> ${args.outputPath}`);
    return;
  }

  const failures = failedChecks.map((check) => `${check.name}: ${check.message}`).join("; ");
  if (args.allowSkip && !args.strict) {
    console.warn(`[live-prereqs] skipped (${args.lane}) due to --allow-skip: ${failures}`);
    return;
  }

  throw new Error(`Live prerequisites failed (${args.lane}): ${failures}`);
}

main().catch((error) => {
  console.error("[live-prereqs] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
