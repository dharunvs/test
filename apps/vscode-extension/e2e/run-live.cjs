const path = require("path");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const { runTests } = require("@vscode/test-electron");

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
  const fixturesPath = process.env.BRANCHLINE_LIVE_FIXTURES;
  if (!fixturesPath) {
    throw new Error("BRANCHLINE_LIVE_FIXTURES is required for extension live E2E");
  }

  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index.cjs");
  const apiBaseUrl = process.env.BRANCHLINE_API_BASE_URL ?? fixtures.apiBaseUrl;

  if (!apiBaseUrl) {
    throw new Error("BRANCHLINE_API_BASE_URL or fixtures.apiBaseUrl is required");
  }

  const extensionUser = fixtures?.users?.extension;
  if (!extensionUser?.email || !extensionUser?.bearerToken) {
    throw new Error("fixtures.users.extension email/bearerToken are required");
  }

  let tempRoot;
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branchline-vscode-e2e-live-"));
    const workspacePath = path.join(tempRoot, "workspace");
    const originPath = path.join(tempRoot, "origin.git");
    prepareWorkspace(workspacePath, originPath);

    process.env.BRANCHLINE_E2E_MODE = "live";
    process.env.BRANCHLINE_API_BASE_URL = apiBaseUrl;
    process.env.BRANCHLINE_E2E_SKIP_BROWSER = "1";
    process.env.BRANCHLINE_E2E_EMAIL = extensionUser.email;
    process.env.BRANCHLINE_E2E_ASSERT_BEARER_TOKEN = extensionUser.bearerToken;
    process.env.BRANCHLINE_E2E_ORG_ID = fixtures.org.id;
    process.env.BRANCHLINE_E2E_PROJECT_ID = fixtures.project.id;
    process.env.BRANCHLINE_E2E_REPOSITORY_ID = fixtures.repositories.main.id;
    process.env.BRANCHLINE_E2E_REPOSITORY_MISMATCH_ID = fixtures.repositories.mismatch.id;
    process.env.BRANCHLINE_E2E_TASK_TITLE = "live-extension-e2e-default-task";

    delete process.env.ELECTRON_RUN_AS_NODE;

    await runTests({
      version: "1.98.0",
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspacePath]
    });
  } finally {
    if (tempRoot) {
      fs.rmSync(tempRoot, {
        recursive: true,
        force: true
      });
    }
  }
}

void main().catch((error) => {
  console.error("VS Code extension live E2E failed");
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
});
