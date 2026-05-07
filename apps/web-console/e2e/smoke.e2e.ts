import { expect, test } from "@playwright/test";

test("onboarding flow supports create org -> create project -> active scope", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const orgName = `Onboarding Org ${suffix}`;
  const orgSlug = `onboarding-org-${suffix}`;
  const projectName = `Onboarding Project ${suffix}`;
  const projectKey = `OB${suffix.slice(-4)}`;

  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible();

  await page.getByLabel("Organization Name").fill(orgName);
  await page.getByLabel("Slug").fill(orgSlug);
  await page.getByRole("button", { name: "Create Organization" }).click();
  await page.waitForURL(/\/onboarding\?org=created/);
  await expect(page.getByText("Organization created successfully.")).toBeVisible();

  await page.getByLabel("Project Name").fill(projectName);
  await page.getByLabel("Project Key").fill(projectKey);
  await page.getByRole("button", { name: "Create Project" }).click();
  await page.waitForURL(/\/onboarding\?project=created/);
  await expect(page.getByText("Project created successfully.")).toBeVisible();
});

test("timeline page renders task-scoped last-5 intent events", async ({ page }) => {
  await page.goto("/timeline");
  await expect(page.getByRole("heading", { name: "Intent Timeline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load Timeline" })).toBeVisible();
  await expect(page.getByText(/Commit:/).first()).toBeVisible();
  await expect(page.getByText(/AI Summary:/).first()).toBeVisible();
  await expect(page.getByText(/Files:/).first()).toBeVisible();
});

test("shell navigation is wedge-only with sidebar + topbar", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByLabel("Primary navigation");
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByLabel("Breadcrumb")).toContainText("Dashboard");

  await expect(nav.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Onboarding" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Projects" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Timeline" })).toBeVisible();

  await expect(nav.getByRole("link", { name: "Tasks" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Quality" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Integrations" })).toHaveCount(0);
});

test("mobile shell supports sidebar drawer toggle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const openMenu = page.getByLabel("Open navigation");
  await expect(openMenu).toBeVisible();
  await openMenu.click();

  const nav = page.getByLabel("Primary navigation");
  await expect(nav.getByRole("link", { name: "Timeline" })).toBeVisible();
  await page.getByLabel("Close navigation").click();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(hasHorizontalOverflow).toBeFalsy();
});

test("auth fallback pages render and realtime token route returns deterministic token", async ({
  page,
  request
}) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();

  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: /sign up/i })).toBeVisible();

  const response = await request.get("/api/realtime-token");
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual(
    expect.objectContaining({
      token: expect.any(String)
    })
  );
});
