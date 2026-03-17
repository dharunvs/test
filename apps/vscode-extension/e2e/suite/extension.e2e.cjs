const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const E2E_MODE = process.env.BRANCHLINE_E2E_MODE ?? (process.env.BRANCHLINE_E2E_STATE_URL ? "mock" : "live");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

async function readMockState() {
  const stateUrl = process.env.BRANCHLINE_E2E_STATE_URL;
  assert.ok(stateUrl, "Expected BRANCHLINE_E2E_STATE_URL to be configured");
  const response = await fetch(stateUrl);
  assert.equal(response.status, 200, "Expected state endpoint to return 200");
  return response.json();
}

function getWorkspacePath() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspaceFolder, "Expected a workspace folder for extension E2E");
  return workspaceFolder;
}

function workspaceHash(workspacePath) {
  return createHash("sha256").update(workspacePath).digest("hex");
}

async function apiRequest(pathname, init = {}) {
  const baseUrl = process.env.BRANCHLINE_API_BASE_URL;
  const token = process.env.BRANCHLINE_E2E_ASSERT_BEARER_TOKEN;
  assert.ok(baseUrl, "Expected BRANCHLINE_API_BASE_URL for live extension E2E");
  assert.ok(token, "Expected BRANCHLINE_E2E_ASSERT_BEARER_TOKEN for live extension E2E assertions");

  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Live API assertion failed: ${response.status} ${response.statusText} ${text}`);
  }

  if (!text) {
    return {};
  }

  return JSON.parse(text);
}

async function validateWorkspace(projectId, repositoryId, hash) {
  return apiRequest("/workspaces/validate", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      repositoryId,
      workspaceHash: hash
    })
  });
}

async function findLatestTaskByTitle(projectId, title) {
  const tasks = await apiRequest(`/tasks?projectId=${projectId}&limit=100`);
  assert.ok(Array.isArray(tasks), "Expected task list response");
  const matching = tasks.filter((task) => task.title === title);
  assert.ok(matching.length > 0, `Expected to find task with title '${title}'`);
  return matching[0];
}

async function getTaskDetails(taskId) {
  return apiRequest(`/tasks/${taskId}`);
}

suite("Branchline Extension E2E", () => {
  test("registers core collaboration commands", async () => {
    const extension = vscode.extensions.all.find(
      (candidate) =>
        candidate.packageJSON?.publisher === "branchline" &&
        candidate.packageJSON?.name === "branchline-vscode-extension"
    );
    assert.ok(extension, "Expected branchline extension to be available in host");
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    const expected = [
      "branchline.login",
      "branchline.bindWorkspace",
      "branchline.startAiTask",
      "branchline.createHandoff",
      "branchline.acknowledgeHandoff",
      "branchline.viewReplay",
      "branchline.viewTimeline",
      "branchline.claimFileOwnership"
    ];

    for (const command of expected) {
      assert.ok(commands.includes(command), `Expected command '${command}' to be registered`);
    }
  });

  test("registers panel and helper commands", async () => {
    const commands = await vscode.commands.getCommands(true);
    const expected = [
      "branchline.timeline.refresh",
      "branchline.activity.refresh",
      "branchline.conflicts.refresh",
      "branchline.handoffs.refresh",
      "branchline.replay.refresh",
      "branchline.timeline.setFilter",
      "branchline.conflicts.dismiss",
      "branchline.conflicts.openFile",
      "branchline.replay.markPosition"
    ];

    for (const command of expected) {
      assert.ok(commands.includes(command), `Expected command '${command}' to be registered`);
    }
  });

  test("executes non-interactive panel commands", async () => {
    await vscode.commands.executeCommand("branchline.timeline.refresh");
    await vscode.commands.executeCommand("branchline.activity.refresh");
    await vscode.commands.executeCommand("branchline.conflicts.refresh");
    await vscode.commands.executeCommand("branchline.handoffs.refresh");
    await vscode.commands.executeCommand("branchline.replay.refresh");
    await vscode.commands.executeCommand(
      "branchline.conflicts.dismiss",
      "task-e2e",
      "conflict-e2e"
    );
    await vscode.commands.executeCommand("branchline.replay.markPosition", "task-e2e", 1);
  });

  test("runs behavioral contributor flow with login refresh, bind validation, and guarded branch orchestration", async () => {
    const workspacePath = getWorkspacePath();
    const trackedSourceFile = path.join(workspacePath, "src", "index.ts");
    const projectId = process.env.BRANCHLINE_E2E_PROJECT_ID;
    const mainRepoId = process.env.BRANCHLINE_E2E_REPOSITORY_ID;
    const mismatchRepoId = process.env.BRANCHLINE_E2E_REPOSITORY_MISMATCH_ID;

    assert.ok(projectId, "Expected BRANCHLINE_E2E_PROJECT_ID");
    assert.ok(mainRepoId, "Expected BRANCHLINE_E2E_REPOSITORY_ID");
    assert.ok(mismatchRepoId, "Expected BRANCHLINE_E2E_REPOSITORY_MISMATCH_ID");

    await vscode.commands.executeCommand("branchline.login");
    await sleep(1300);

    process.env.BRANCHLINE_E2E_REPOSITORY_ID = mismatchRepoId;
    await vscode.commands.executeCommand("branchline.bindWorkspace");

    if (E2E_MODE === "mock") {
      const mismatchState = await readMockState();
      assert.equal(mismatchState.workspace.bindCalls, 0, "Expected bind to be skipped for invalid mapping");

      process.env.BRANCHLINE_E2E_REPOSITORY_ID = mismatchState.ids.REPO_MAIN_ID;
      await vscode.commands.executeCommand("branchline.bindWorkspace");

      const boundState = await readMockState();
      assert.equal(boundState.workspace.bindCalls, 1, "Expected successful workspace binding");
      assert.ok(boundState.auth.refreshCalls >= 1, "Expected refresh token rotation to execute");
    } else {
      const validationAfterMismatch = await validateWorkspace(projectId, mainRepoId, workspaceHash(workspacePath));
      assert.equal(
        validationAfterMismatch.valid,
        false,
        "Expected workspace binding to remain invalid after mismatch-blocked bind"
      );

      process.env.BRANCHLINE_E2E_REPOSITORY_ID = mainRepoId;
      await vscode.commands.executeCommand("branchline.bindWorkspace");

      const validationAfterBind = await validateWorkspace(projectId, mainRepoId, workspaceHash(workspacePath));
      assert.equal(validationAfterBind.valid, true, "Expected workspace binding to be valid after bind");
    }

    fs.appendFileSync(trackedSourceFile, `\n// guardrail trigger ${Date.now()}\n`, "utf8");
    process.env.BRANCHLINE_E2E_TASK_TITLE = "Guardrail blocked task";
    await vscode.commands.executeCommand("branchline.startAiTask");

    if (E2E_MODE === "mock") {
      const guardrailState = await readMockState();
      assert.ok(guardrailState.task.guardrailBlocks >= 1, "Expected pre_apply guardrail blocking path");
      assert.equal(
        guardrailState.task.branchesCreated,
        0,
        "Expected no branch orchestration when pre_apply guardrail blocks"
      );
    } else {
      const blockedTask = await findLatestTaskByTitle(projectId, "Guardrail blocked task");
      const blockedTaskDetails = await getTaskDetails(blockedTask.id);
      assert.equal(blockedTaskDetails.branches.length, 0, "Expected no branches when pre-apply guardrail blocks");
    }

    runGit(workspacePath, ["add", "src/index.ts"]);
    runGit(workspacePath, ["commit", "-m", "test: normalize workspace before protected-branch check"]);
    runGit(workspacePath, ["checkout", "main"]);

    process.env.BRANCHLINE_E2E_TASK_TITLE = "Protected branch block task";
    await vscode.commands.executeCommand("branchline.startAiTask");

    if (E2E_MODE === "mock") {
      const protectedState = await readMockState();
      assert.ok(
        protectedState.task.protectedBranchBlocks >= 1,
        "Expected protected branch block from branch creation policy"
      );
    } else {
      const blockedTask = await findLatestTaskByTitle(projectId, "Protected branch block task");
      const blockedTaskDetails = await getTaskDetails(blockedTask.id);
      assert.equal(blockedTaskDetails.branches.length, 0, "Expected protected branch path to block branch creation");
    }

    runGit(workspacePath, ["checkout", "source-work"]);
    process.env.BRANCHLINE_E2E_TASK_TITLE = "Happy path branch orchestration task";
    await vscode.commands.executeCommand("branchline.startAiTask");

    if (E2E_MODE === "mock") {
      const successState = await readMockState();
      assert.ok(successState.task.branchesCreated >= 1, "Expected branch orchestration to run");
      assert.ok(successState.task.ensurePrCalls >= 1, "Expected ensure PR path to run");
      assert.ok(successState.task.intentEvents >= 1, "Expected intent event emission");
      assert.ok(successState.task.commitMetadataEvents >= 1, "Expected commit metadata ingestion");
    } else {
      const successTask = await findLatestTaskByTitle(projectId, "Happy path branch orchestration task");
      const successTaskDetails = await getTaskDetails(successTask.id);
      assert.ok(successTaskDetails.branches.length >= 1, "Expected branch orchestration to create branch records");
    }

    const currentBranch = runGit(workspacePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    assert.ok(
      currentBranch.startsWith("branchline/") || currentBranch.startsWith("ai/"),
      `Expected generated branchline/* or ai/* checkout, received ${currentBranch}`
    );

    const lastCommitMessage = runGit(workspacePath, ["log", "-1", "--pretty=%B"]);
    assert.ok(
      lastCommitMessage.includes("X-Collab-Run-Id:"),
      "Expected last commit to include Branchline metadata trailers"
    );
    assert.ok(
      lastCommitMessage.includes("X-Collab-Task-Id:"),
      "Expected last commit to include task metadata trailers"
    );
  });
});
