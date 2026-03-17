import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3100);
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 4100);
const e2eBearerToken = process.env.BRANCHLINE_E2E_BEARER_TOKEN ?? "branchline-e2e-token";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  testIgnore: "**/live.e2e.ts",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  webServer: [
    {
      command: `PLAYWRIGHT_WEB_PORT=${port} PLAYWRIGHT_API_PORT=${apiPort} BRANCHLINE_E2E_BEARER_TOKEN=${e2eBearerToken} node ./e2e/mock-api-server.cjs`,
      port: apiPort,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI
    },
    {
      command: `BRANCHLINE_API_BASE_URL=http://127.0.0.1:${apiPort}/v1 BRANCHLINE_E2E_BEARER_TOKEN=${e2eBearerToken} PLAYWRIGHT_WEB_PORT=${port} PLAYWRIGHT_API_PORT=${apiPort} next dev --port ${port}`,
      port,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI
    }
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
