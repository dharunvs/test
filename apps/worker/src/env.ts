import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  OBSERVABILITY_ENABLED: z.coerce.boolean().default(false)
});

export interface WorkerEnv {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  redisUrl: string;
  observabilityEnabled: boolean;
}

let loaded = false;
let cachedEnv: WorkerEnv | null = null;

function loadEnvironmentFiles() {
  if (loaded) {
    return;
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env.local"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), "../../.env.local"),
    resolve(process.cwd(), "../../.env"),
    resolve(moduleDir, "../../.env.local"),
    resolve(moduleDir, "../../.env"),
    resolve(moduleDir, "../../../.env.local"),
    resolve(moduleDir, "../../../.env"),
    resolve(moduleDir, "../../../../.env.local"),
    resolve(moduleDir, "../../../../.env")
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    loadDotenv({
      path: filePath,
      override: false
    });
  }

  loaded = true;
}

export function readWorkerEnv(): WorkerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  loadEnvironmentFiles();
  const parsed = envSchema.parse(process.env);

  cachedEnv = {
    nodeEnv: parsed.NODE_ENV,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    observabilityEnabled: parsed.OBSERVABILITY_ENABLED
  };

  return cachedEnv;
}
