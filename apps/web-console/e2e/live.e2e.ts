import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const fixturePath = process.env.BRANCHLINE_LIVE_FIXTURES;
if (!fixturePath) {
  throw new Error("BRANCHLINE_LIVE_FIXTURES is required for live web E2E");
}

const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  org: { id: string };
  project: { id: string };
  seededTask?: { id?: string | null } | null;
};

test.beforeEach(async ({ context, baseURL }) => {
  const scopeUrl = baseURL ?? "http://127.0.0.1:3000";

  await context.addCookies([
    {
      name: "branchline.active_org_id",
      value: fixtures.org.id,
      url: scopeUrl
    },
    {
      name: "branchline.active_project_id",
      value: fixtures.project.id,
      url: scopeUrl
    }
  ]);
});

test("onboarding path supports create org -> create project with live API", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const orgName = `Live Onboarding Org ${suffix}`;
  const orgSlug = `live-onboarding-${suffix}`;
  const projectName = `Live Onboarding Project ${suffix}`;
  const projectKey = `LO${suffix.slice(-4)}`;

  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible();

  await page.getByLabel("Organization Name").fill(orgName);
  await page.getByLabel("Slug").fill(orgSlug);
  await page.getByRole("button", { name: "Create Organization" }).click();
  await page.waitForURL(/\/onboarding\?org=created/);

  const organizationSelect = page.locator('select[name="orgId"]').first();
  await organizationSelect.selectOption({ label: `${orgName} (owner)` });
  await page.getByLabel("Project Name").fill(projectName);
  await page.getByLabel("Project Key").fill(projectKey);
  await page.getByRole("button", { name: "Create Project" }).click();
  await page.waitForURL(/\/onboarding\?project=created/);

  await expect(page.getByText("Project created successfully.")).toBeVisible();
});

test("control plane and reviewer surfaces render with seeded live scope", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Control Plane" })).toBeVisible();

  await page.goto("/repositories");
  await expect(page.getByRole("heading", { name: "Repositories and GitHub Installations" })).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks and Branches" })).toBeVisible();

  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "Live Activity" })).toBeVisible();
  await expect(page.getByText(/Realtime propagation p95:/)).toBeVisible();

  if (fixtures.seededTask?.id) {
    await page.goto(`/replay?taskId=${fixtures.seededTask.id}`);
    await expect(page.getByRole("heading", { name: "Replay and Provenance" })).toBeVisible();

    await page.goto(`/provenance?taskId=${fixtures.seededTask.id}`);
    await expect(page.getByRole("heading", { name: "Provenance Graph" })).toBeVisible();

    await page.goto(`/quality?taskId=${fixtures.seededTask.id}`);
    await expect(page.getByRole("heading", { name: "Quality Gates" })).toBeVisible();
  }
});
