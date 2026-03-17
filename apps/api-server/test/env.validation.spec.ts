import { afterEach, describe, expect, it } from "vitest";

import { readEnv, resetEnvCache } from "../src/common/env.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }

  resetEnvCache();
});

describe("env validation", () => {
  it("rejects placeholder PR override outside development", () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_JWT_SECRET = "branchline-production-auth-secret";
    process.env.GITHUB_WEBHOOK_SECRET = "branchline-production-webhook-secret";
    process.env.GITHUB_ALLOW_PLACEHOLDER_PR = "true";

    expect(() => readEnv()).toThrow("GITHUB_ALLOW_PLACEHOLDER_PR can only be enabled in development");
  });
});
