const path = require("path");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const { runTests } = require("@vscode/test-electron");

const { IDS, startMockApiServer } = require("./mock-api-server.cjs");

function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function prepareWorkspace(workspacePath, originPath) {
  fs.mkdirSync(workspacePath, {
    recursive: true
  });

  fs.mkdirSync(path.join(workspacePath, "src"), {
    recursive: true
  });
  fs.writeFileSync(path.join(workspacePath, "README.md"), "# Branchline Extension E2E\n", "utf8");
  fs.writeFileSync(
    path.join(workspacePath, "src", "index.ts"),
    'export const hello = "branchline-extension-e2e";\n',
    "utf8"
  );

  runGit(workspacePath, ["init", "--initial-branch=main"]);
  runGit(workspacePath, ["config", "user.email", "branchline-e2e@local.dev"]);
  runGit(workspacePath, ["config", "user.name", "Branchline E2E"]);
  runGit(workspacePath, ["add", "."]);
  runGit(workspacePath, ["commit", "-m", "chore: initial fixture"]);

  runGit(path.dirname(originPath), ["init", "--bare", path.basename(originPath)]);
  runGit(workspacePath, ["remote", "add", "origin", originPath]);
  runGit(workspacePath, ["push", "-u", "origin", "main"]);

  runGit(workspacePath, ["checkout", "-b", "source-work"]);
  fs.appendFileSync(path.join(workspacePath, "src", "index.ts"), 'export const branch = "source-work";\n', "utf8");
  runGit(workspacePath, ["add", "."]);
  runGit(workspacePath, ["commit", "-m", "chore: source-work baseline"]);
  runGit(workspacePath, ["push", "-u", "origin", "source-work"]);
  runGit(workspacePath, ["checkout", "main"]);
}

async function main() {
  let mockServer;
  let tempRoot;
  try {
    mockServer = await startMockApiServer();
    const extensionDevelopmentPath = path.resolve(__dirname, "..");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index.cjs");
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branchline-vscode-e2e-"));
    const workspacePath = path.join(tempRoot, "workspace");
    const originPath = path.join(tempRoot, "origin.git");
    prepareWorkspace(workspacePath, originPath);

    process.env.BRANCHLINE_API_BASE_URL = `${mockServer.baseUrl}/v1`;
    process.env.BRANCHLINE_E2E_STATE_URL = `${mockServer.baseUrl}/__state`;
    process.env.BRANCHLINE_E2E_SKIP_BROWSER = "1";
    process.env.BRANCHLINE_E2E_EMAIL = "extension-e2e@branchline.dev";
    process.env.BRANCHLINE_E2E_ORG_ID = IDS.ORG_ID;
    process.env.BRANCHLINE_E2E_PROJECT_ID = IDS.PROJECT_ID;
    process.env.BRANCHLINE_E2E_REPOSITORY_ID = IDS.REPO_MAIN_ID;
    process.env.BRANCHLINE_E2E_REPOSITORY_MISMATCH_ID = IDS.REPO_MISMATCH_ID;
    process.env.BRANCHLINE_E2E_TASK_TITLE = "default-extension-e2e-task";

    // CI/agent environments often export this globally, which makes VS Code boot as a Node CLI.
    delete process.env.ELECTRON_RUN_AS_NODE;

    await runTests({
      version: "1.98.0",
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspacePath]
    });
  } catch (error) {
    console.error("VS Code extension E2E failed");
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exit(1);
  } finally {
    if (tempRoot) {
      fs.rmSync(tempRoot, {
        recursive: true,
        force: true
      });
    }
    if (mockServer?.stop) {
      await mockServer.stop();
    }
  }
}

void main();
