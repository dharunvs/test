import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) {
      continue;
    }

    const trimmed = raw.slice(2);
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex >= 0) {
      const key = trimmed.slice(0, equalsIndex);
      const value = trimmed.slice(equalsIndex + 1);
      args.set(key, value.length > 0 ? value : "true");
      continue;
    }

    const maybeValue = argv[index + 1];
    if (maybeValue && !maybeValue.startsWith("--")) {
      args.set(trimmed, maybeValue);
      index += 1;
      continue;
    }

    args.set(trimmed, "true");
  }
  return args;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options
  });

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? "unknown"}): ${command} ${args.join(" ")}`);
  }
}

function waitFor(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForHttpReady(input) {
  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(input.url, {
        method: "GET"
      });

      if (response.ok) {
        return;
      }
    } catch {
      // Best effort polling until timeout.
    }

    await waitFor(1000);
  }

  throw new Error(`Timed out waiting for ${input.name} readiness at ${input.url}`);
}

function spawnProcess(name, command, args, env) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env,
    shell: false
  });

  child.on("exit", (code, signal) => {
    if (code === 0 || signal === "SIGTERM") {
      return;
    }
    console.error(`[full-stack] process '${name}' exited unexpectedly with code=${code} signal=${signal}`);
  });

  return child;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const durationSeconds = Number(args.get("durationSeconds") ?? 0);
  const followupCommand = args.get("run");
  const readinessTimeoutMs = Number(args.get("readinessTimeoutMs") ?? 120_000);
  const apiReadyUrlArg = args.get("apiReadyUrl");
  const webReadyUrlArg = args.get("webReadyUrl");
  const apiPort = Number(args.get("apiPort") ?? process.env.BRANCHLINE_FULL_STACK_API_PORT ?? 4000);
  const webPort = Number(args.get("webPort") ?? process.env.BRANCHLINE_FULL_STACK_WEB_PORT ?? 3000);
  const skipDockerPostgres =
    args.get("skip-docker-postgres") === "true" ||
    process.env.BRANCHLINE_FULL_STACK_SKIP_DOCKER_POSTGRES === "1";
  const skipDockerRedis =
    args.get("skip-docker-redis") === "true" ||
    process.env.BRANCHLINE_FULL_STACK_SKIP_DOCKER_REDIS === "1";

  const defaultApiBaseUrl = `http://127.0.0.1:${apiPort}/v1`;
  const env = {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ?? "postgresql://branchline:branchline@localhost:5432/branchline",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    BRANCHLINE_API_BASE_URL: process.env.BRANCHLINE_API_BASE_URL ?? defaultApiBaseUrl,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.BRANCHLINE_API_BASE_URL ?? defaultApiBaseUrl
  };
  const apiEnv = {
    ...env,
    PORT: String(apiPort)
  };
  const webEnv = {
    ...env,
    PORT: String(webPort)
  };
  const apiBaseUrl = env.BRANCHLINE_API_BASE_URL.replace(/\/v1\/?$/, "");
  const apiReadyUrl = apiReadyUrlArg ?? `${apiBaseUrl}/v1/observability/readiness`;
  const webReadyUrl = webReadyUrlArg ?? process.env.NEXT_PUBLIC_WEB_BASE_URL ?? `http://127.0.0.1:${webPort}`;

  const dockerServices = [];
  if (!skipDockerPostgres) {
    dockerServices.push("postgres");
  }
  if (!skipDockerRedis) {
    dockerServices.push("redis");
  }
  if (dockerServices.length > 0) {
    console.log(`[full-stack] bootstrapping docker services: ${dockerServices.join(", ")}`);
    runCommand("docker", ["compose", "-f", "infra/docker/docker-compose.yml", "up", "-d", ...dockerServices], {
      env
    });
  } else {
    console.log("[full-stack] skipping docker service bootstrap (postgres + redis)");
  }

  console.log("[full-stack] ensuring prisma schema + migrations are applied");
  runCommand("pnpm", ["--filter", "@branchline/api-server", "prisma:generate"], { env });
  runCommand("pnpm", ["--filter", "@branchline/api-server", "exec", "prisma", "migrate", "deploy"], { env });

  console.log("[full-stack] starting API server, worker, and web console");
  const processes = [
    spawnProcess("api-server", "pnpm", ["--filter", "@branchline/api-server", "dev"], apiEnv),
    spawnProcess("worker", "pnpm", ["--filter", "@branchline/worker", "dev"], env),
    spawnProcess("web-console", "pnpm", ["--filter", "@branchline/web-console", "dev", "--port", String(webPort)], webEnv)
  ];

  const shutdown = () => {
    for (const child of processes) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[full-stack] waiting for api/web readiness");
  try {
    await waitForHttpReady({
      name: "api-server",
      url: apiReadyUrl,
      timeoutMs: readinessTimeoutMs
    });
    await waitForHttpReady({
      name: "web-console",
      url: webReadyUrl,
      timeoutMs: readinessTimeoutMs
    });
  } catch (error) {
    shutdown();
    throw error;
  }

  if (followupCommand) {
    console.log(`[full-stack] running follow-up command: ${followupCommand}`);
    const runResult = spawnSync(followupCommand, {
      shell: true,
      stdio: "inherit",
      env
    });

    shutdown();

    if (runResult.status !== 0) {
      process.exit(runResult.status ?? 1);
    }

    return;
  }

  if (durationSeconds > 0) {
    console.log(`[full-stack] running for ${durationSeconds}s`);
    await waitFor(durationSeconds * 1000);
    shutdown();
    return;
  }

  console.log("[full-stack] stack is running. Press Ctrl+C to stop.");
  await new Promise(() => {
    // Keep process alive until interrupted.
  });
}

main().catch((error) => {
  console.error("[full-stack] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
