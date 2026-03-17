import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

let envFilesLoaded = false;

function loadEnvironmentFiles() {
  if (envFilesLoaded) {
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
    resolve(moduleDir, "../../../../.env"),
    resolve(moduleDir, "../../../../../.env.local"),
    resolve(moduleDir, "../../../../../.env")
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

  envFilesLoaded = true;
}

const optionalString = () =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().optional()
  );

const optionalUrl = () =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().url().optional()
  );

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).default("postgresql://branchline:branchline@localhost:5432/branchline"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  AUTH_JWT_SECRET: z.string().min(16).default("branchline-dev-auth-secret"),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  AUTH_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  AUTH_DEVICE_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  CLERK_JWKS_URL: optionalUrl(),
  CLERK_ISSUER: optionalString(),
  GITHUB_WEBHOOK_SECRET: z.string().min(8).default("branchline-dev-webhook-secret"),
  GITHUB_APP_ID: optionalString(),
  GITHUB_APP_PRIVATE_KEY: optionalString(),
  GITHUB_CLIENT_ID: optionalString(),
  GITHUB_CLIENT_SECRET: optionalString(),
  GITHUB_ALLOW_PLACEHOLDER_PR: z.coerce.boolean().default(false),
  GITHUB_RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().nonnegative().default(0),
  GITHUB_RECONCILE_LIMIT: z.coerce.number().int().positive().max(1000).default(200),
  OBSERVABILITY_ENABLED: z.coerce.boolean().default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl(),
  SENTRY_DSN: optionalUrl(),
  REALTIME_ALLOW_ANONYMOUS: z.coerce.boolean().optional(),
  SLACK_CLIENT_ID: optionalString(),
  SLACK_CLIENT_SECRET: optionalString(),
  LINEAR_CLIENT_ID: optionalString(),
  LINEAR_CLIENT_SECRET: optionalString(),
  JIRA_CLIENT_ID: optionalString(),
  JIRA_CLIENT_SECRET: optionalString(),
  SLACK_OAUTH_SCOPES: optionalString(),
  LINEAR_OAUTH_SCOPES: optionalString(),
  JIRA_OAUTH_SCOPES: optionalString(),
  API_PUBLIC_BASE_URL: z.string().url().default("http://localhost:4000"),
  WEB_CONSOLE_BASE_URL: z.string().url().default("http://localhost:3000"),
  INTEGRATIONS_ENCRYPTION_KEY: optionalString(),
  ACTIVITY_PRESENCE_TTL_SECONDS: z.coerce.number().int().positive().default(120)
});

export interface AppEnv {
  port: number;
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  redisUrl: string;
  authJwtSecret: string;
  authAccessTokenTtlSeconds: number;
  authRefreshTokenTtlDays: number;
  authDeviceCodeTtlSeconds: number;
  clerkJwksUrl?: string;
  clerkIssuer?: string;
  githubWebhookSecret: string;
  githubAppId?: string;
  githubAppPrivateKey?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  githubAllowPlaceholderPr: boolean;
  githubReconcileIntervalSeconds: number;
  githubReconcileLimit: number;
  observabilityEnabled: boolean;
  otelExporterOtlpEndpoint?: string;
  sentryDsn?: string;
  realtimeAllowAnonymous: boolean;
  slackClientId?: string;
  slackClientSecret?: string;
  linearClientId?: string;
  linearClientSecret?: string;
  jiraClientId?: string;
  jiraClientSecret?: string;
  slackOauthScopes: string;
  linearOauthScopes: string;
  jiraOauthScopes: string;
  apiPublicBaseUrl: string;
  webConsoleBaseUrl: string;
  integrationsEncryptionKey?: string;
  activityPresenceTtlSeconds: number;
}

let cachedEnv: AppEnv | null = null;

function assertConfigured(value: string | undefined, fieldName: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${fieldName}`);
  }
  return value;
}

function assertNotDefault(value: string, disallowed: string, fieldName: string) {
  if (value === disallowed) {
    throw new Error(`${fieldName} cannot use default development secret in production`);
  }
}

export function readEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  loadEnvironmentFiles();

  const parsed = envSchema.parse(process.env);

  if (parsed.NODE_ENV !== "development" && parsed.GITHUB_ALLOW_PLACEHOLDER_PR) {
    throw new Error("GITHUB_ALLOW_PLACEHOLDER_PR can only be enabled in development");
  }

  if (parsed.NODE_ENV === "production") {
    assertNotDefault(
      parsed.AUTH_JWT_SECRET,
      "branchline-dev-auth-secret",
      "AUTH_JWT_SECRET"
    );
    assertNotDefault(
      parsed.GITHUB_WEBHOOK_SECRET,
      "branchline-dev-webhook-secret",
      "GITHUB_WEBHOOK_SECRET"
    );

    if ((parsed.CLERK_JWKS_URL && !parsed.CLERK_ISSUER) || (!parsed.CLERK_JWKS_URL && parsed.CLERK_ISSUER)) {
      throw new Error("CLERK_JWKS_URL and CLERK_ISSUER must both be set in production when Clerk auth is enabled");
    }

    if (parsed.OBSERVABILITY_ENABLED) {
      assertConfigured(parsed.OTEL_EXPORTER_OTLP_ENDPOINT, "OTEL_EXPORTER_OTLP_ENDPOINT");
    }

    const hasOAuthProvider =
      (parsed.SLACK_CLIENT_ID && parsed.SLACK_CLIENT_SECRET) ||
      (parsed.LINEAR_CLIENT_ID && parsed.LINEAR_CLIENT_SECRET) ||
      (parsed.JIRA_CLIENT_ID && parsed.JIRA_CLIENT_SECRET);
    if (hasOAuthProvider) {
      assertConfigured(parsed.INTEGRATIONS_ENCRYPTION_KEY, "INTEGRATIONS_ENCRYPTION_KEY");
    }
  }

  cachedEnv = {
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    authJwtSecret: parsed.AUTH_JWT_SECRET,
    authAccessTokenTtlSeconds: parsed.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    authRefreshTokenTtlDays: parsed.AUTH_REFRESH_TOKEN_TTL_DAYS,
    authDeviceCodeTtlSeconds: parsed.AUTH_DEVICE_CODE_TTL_SECONDS,
    clerkJwksUrl: parsed.CLERK_JWKS_URL,
    clerkIssuer: parsed.CLERK_ISSUER,
    githubWebhookSecret: parsed.GITHUB_WEBHOOK_SECRET,
    githubAppId: parsed.GITHUB_APP_ID,
    githubAppPrivateKey: parsed.GITHUB_APP_PRIVATE_KEY,
    githubClientId: parsed.GITHUB_CLIENT_ID,
    githubClientSecret: parsed.GITHUB_CLIENT_SECRET,
    githubAllowPlaceholderPr: parsed.GITHUB_ALLOW_PLACEHOLDER_PR,
    githubReconcileIntervalSeconds: parsed.GITHUB_RECONCILE_INTERVAL_SECONDS,
    githubReconcileLimit: parsed.GITHUB_RECONCILE_LIMIT,
    observabilityEnabled: parsed.OBSERVABILITY_ENABLED,
    otelExporterOtlpEndpoint: parsed.OTEL_EXPORTER_OTLP_ENDPOINT,
    sentryDsn: parsed.SENTRY_DSN,
    realtimeAllowAnonymous:
      parsed.REALTIME_ALLOW_ANONYMOUS ?? parsed.NODE_ENV !== "production",
    slackClientId: parsed.SLACK_CLIENT_ID,
    slackClientSecret: parsed.SLACK_CLIENT_SECRET,
    linearClientId: parsed.LINEAR_CLIENT_ID,
    linearClientSecret: parsed.LINEAR_CLIENT_SECRET,
    jiraClientId: parsed.JIRA_CLIENT_ID,
    jiraClientSecret: parsed.JIRA_CLIENT_SECRET,
    slackOauthScopes: parsed.SLACK_OAUTH_SCOPES ?? "channels:read chat:write",
    linearOauthScopes: parsed.LINEAR_OAUTH_SCOPES ?? "read write",
    jiraOauthScopes:
      parsed.JIRA_OAUTH_SCOPES ?? "read:jira-work write:jira-work offline_access read:me",
    apiPublicBaseUrl: parsed.API_PUBLIC_BASE_URL,
    webConsoleBaseUrl: parsed.WEB_CONSOLE_BASE_URL,
    integrationsEncryptionKey: parsed.INTEGRATIONS_ENCRYPTION_KEY,
    activityPresenceTtlSeconds: parsed.ACTIVITY_PRESENCE_TTL_SECONDS
  };

  return cachedEnv;
}

export function resetEnvCache() {
  cachedEnv = null;
}
