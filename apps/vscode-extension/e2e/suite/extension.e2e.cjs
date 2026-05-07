const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const vscode = require("vscode");

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

suite("Branchline Extension E2E", () => {
  test("registers wedge commands only", async () => {
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
      "branchline.viewTimeline"
    ];

    for (const command of expected) {
      assert.ok(commands.includes(command), `Expected command '${command}' to be registered`);
    }

    const removed = [
      "branchline.createHandoff",
      "branchline.acknowledgeHandoff",
      "branchline.viewReplay",
      "branchline.claimFileOwnership"
    ];

    for (const command of removed) {
      assert.equal(commands.includes(command), false, `Expected command '${command}' to be removed`);
    }
  });

  test("runs wedge flow: login -> bind -> start task -> capture intent -> view timeline", async () => {
    const workspacePath = getWorkspacePath();

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

    const mismatchState = await readMockState();
    assert.equal(mismatchState.workspace.bindCalls, 0, "Expected bind to be skipped for invalid mapping");

    process.env.BRANCHLINE_E2E_REPOSITORY_ID = mismatchState.ids.REPO_MAIN_ID;
    await vscode.commands.executeCommand("branchline.bindWorkspace");

    const boundState = await readMockState();
    assert.equal(boundState.workspace.bindCalls, 1, "Expected successful workspace binding");
    assert.ok(boundState.auth.refreshCalls >= 1, "Expected refresh token rotation to execute");

    const validationHash = workspaceHash(workspacePath);
    assert.ok(typeof validationHash === "string" && validationHash.length > 0);

    runGit(workspacePath, ["checkout", "source-work"]);

    process.env.BRANCHLINE_E2E_TASK_TITLE = "Happy path branch orchestration task";
    process.env.BRANCHLINE_E2E_INTENT_PROMPT = "Create timeline-first UI";
    process.env.BRANCHLINE_E2E_INTENT_SUMMARY = "Added timeline page and intent capture flow";
    await vscode.commands.executeCommand("branchline.startAiTask");

    const successState = await readMockState();
    assert.ok(successState.task.created >= 1, "Expected task creation to run");
    assert.ok(successState.task.branchesCreated >= 1, "Expected branch orchestration to run");
    assert.ok(successState.task.intentCaptures >= 1, "Expected simplified intent capture to run");

    await vscode.commands.executeCommand("branchline.viewTimeline");

    const timelineState = await readMockState();
    assert.ok(timelineState.task.timelineReads >= 1, "Expected timeline reads to run");
  });
});
