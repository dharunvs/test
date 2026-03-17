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

  const activeScopeCard = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Set Active Scope" })
  });
  await expect(activeScopeCard.getByLabel("Organization")).toContainText(orgName);
  await expect(activeScopeCard.getByLabel("Project")).toContainText(projectName);
});

test("operator workflow covers team/repo/policy/integration flows", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Control Plane" })).toBeVisible();
  await expect(page.locator('select[name="orgId"]')).toHaveValue("11111111-1111-1111-1111-111111111111");

  await page.goto("/team");
  await expect(page.getByRole("heading", { name: "Team and Memberships" })).toBeVisible();
  const inviteForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Send Invite" })
  });
  await inviteForm.getByPlaceholder("teammate@company.com").fill("pilot-user@branchline.dev");
  await inviteForm.getByRole("combobox").selectOption("viewer");
  await inviteForm.getByRole("button", { name: "Send Invite" }).click();
  await page.waitForURL(/\/team\?invite=sent/);
  await expect(page.getByText("pilot-user@branchline.dev")).toBeVisible();

  const firstRoleUpdateForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Update Role" })
  }).first();
  await firstRoleUpdateForm.getByRole("combobox").selectOption("admin");
  await firstRoleUpdateForm.getByRole("button", { name: "Update Role" }).click();
  await page.waitForURL(/\/team/);

  if ((await page.getByRole("button", { name: "Revoke Invite" }).count()) > 0) {
    await page.getByRole("button", { name: "Revoke Invite" }).first().click();
    await page.waitForURL(/\/team/);
  }

  await page.goto("/repositories");
  await expect(page.getByRole("heading", { name: "Repositories and GitHub Installations" })).toBeVisible();
  await expect(page.getByText("branchline/console-mvp").first()).toBeVisible();
  await page.getByRole("button", { name: "Run Reconciliation" }).click();
  await page.waitForURL(/\/repositories/);

  await page.goto("/projects/22222222-2222-2222-2222-222222222222/policy");
  await expect(page.getByRole("heading", { name: /Policy:/ })).toBeVisible();
  await page.getByRole("button", { name: "Update Policy" }).click();
  await expect(page.getByRole("heading", { name: /Guardrail Policy Versions/i })).toBeVisible();
  if ((await page.getByRole("button", { name: "Activate Version" }).count()) > 0) {
    await page.getByRole("button", { name: "Activate Version" }).first().click();
    await page.waitForURL(/\/projects\/22222222-2222-2222-2222-222222222222\/policy/);
  }

  await page.goto("/integrations");
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await page.getByRole("button", { name: "Connect slack" }).click();
  await page.waitForURL(/\/integrations\?oauth=started/);
  await page.getByRole("button", { name: "Unlink" }).first().click();
  await page.waitForURL(/\/integrations/);
});

test("project knowledge hub supports docs, phases, and approval workflows", async ({ page }) => {
  await page.goto("/projects/22222222-2222-2222-2222-222222222222/knowledge?tab=modules");
  await expect(page.getByRole("heading", { name: "Project Hub" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Modules & Flows" })).toBeVisible();

  await page.getByLabel("Type").first().selectOption("flow_diagram");
  await page.getByLabel("Title").first().fill("Payment Pipeline Flow");
  await page.getByLabel("Mermaid Source").first().fill("flowchart TD\\n  A[Start] --> B[Authorize]\\n  B --> C[Capture]");
  await page.getByRole("button", { name: "Create Doc Draft" }).click();
  await page.waitForURL(/knowledge=doc_created/);
  await expect(page.getByText("Action: doc created")).toBeVisible();

  await page.goto("/projects/22222222-2222-2222-2222-222222222222/knowledge?tab=phases");
  await expect(page.getByRole("heading", { name: "Phases" })).toBeVisible();
  const createPhaseForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Create Phase Draft" })
  });
  await createPhaseForm.getByLabel("Key").fill("phase-1");
  await createPhaseForm.getByLabel("Name").fill("Core Buildout");
  await createPhaseForm.getByRole("button", { name: "Create Phase Draft" }).click();
  await page.waitForURL(/knowledge=phase_created/);
  await expect(page.getByText("Action: phase created")).toBeVisible();

  await page.goto("/projects/22222222-2222-2222-2222-222222222222/knowledge?tab=history");
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
});

test("execution workflow covers tasks/quality/replay/provenance/activity/pivot", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks and Branches" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reviewer Digest" })).toBeVisible();
  await expect(page.getByText("Digest hash: digest-42")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conflict Guidance" })).toBeVisible();
  await expect(page.getByText("Suggested action: split_work_or_rebase_before_merge")).toBeVisible();
  await page.getByRole("button", { name: /Claim apps\/web-console\/app\/tasks\/page\.tsx/ }).click();
  await page.waitForURL(/\/tasks\?taskId=/);
  await page.getByPlaceholder("Optional acknowledgment notes").fill("Taking over from handoff");
  await page.getByRole("button", { name: "Acknowledge Handoff" }).click();
  await page.waitForURL(/\/tasks\?taskId=/);
  await expect(page.getByRole("heading", { name: "PR Slices" })).toBeVisible();
  await expect(page.getByText(/slice 1: Web control-plane updates/)).toBeVisible();

  await page.getByRole("link", { name: "Open provenance graph" }).click();
  await page.waitForURL(/\/provenance\?taskId=/);
  await expect(page.getByRole("heading", { name: "Provenance Graph" })).toBeVisible();
  await expect(page.getByText("Nodes:")).toBeVisible();

  await page.goto("/replay?taskId=44444444-4444-4444-4444-444444444444");
  await expect(page.getByRole("heading", { name: "Replay and Provenance" })).toBeVisible();
  await expect(page.getByText("intent.created")).toBeVisible();

  await page.goto("/quality?taskId=44444444-4444-4444-4444-444444444444");
  await expect(page.getByRole("heading", { name: "Quality Gates" })).toBeVisible();
  await page.getByRole("link", { name: "Open drilldown" }).first().click();
  await page.waitForURL(/\/quality\?taskId=.*runId=/);
  await expect(page.getByRole("heading", { name: "Selected Run Drilldown" })).toBeVisible();
  await expect(page.getByText("Storage: s3:quality/build-log.txt")).toBeVisible();
  await page.getByRole("checkbox", { name: "Include artifact metadata" }).check();
  await page.getByRole("button", { name: "Apply" }).click();
  await page.waitForURL(/includeMetadata=true/);

  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "Live Activity" })).toBeVisible();
  await expect(page.getByText("Active presence:")).toBeVisible();

  await page.goto("/pivot");
  await expect(page.getByRole("heading", { name: "Pivot Reports" })).toBeVisible();
  await expect(page.getByText(/Open stale entries:/).first()).toBeVisible();
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
