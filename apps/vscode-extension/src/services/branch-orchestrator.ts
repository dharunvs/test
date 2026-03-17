import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  return stdout.trim();
}

export async function getCurrentGitBranch(cwd: string): Promise<string> {
  return runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

export async function getPrimaryRemoteUrl(cwd: string): Promise<string | undefined> {
  try {
    const url = await runGit(cwd, ["remote", "get-url", "origin"]);
    return url.length > 0 ? url : undefined;
  } catch {
    return undefined;
  }
}

export async function getHeadCommitSha(cwd: string): Promise<string | undefined> {
  try {
    const sha = await runGit(cwd, ["rev-parse", "HEAD"]);
    return sha.length > 0 ? sha : undefined;
  } catch {
    return undefined;
  }
}

export async function listChangedPaths(cwd: string): Promise<string[]> {
  try {
    const output = await runGit(cwd, ["diff", "--name-only", "--diff-filter=ACMRT"]);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function createAndCheckoutBranch(
  cwd: string,
  branchName: string,
  baseBranch: string
): Promise<void> {
  await runGit(cwd, ["fetch", "origin", baseBranch]);

  try {
    await runGit(cwd, ["checkout", "-B", branchName, `origin/${baseBranch}`]);
    return;
  } catch {
    await runGit(cwd, ["checkout", baseBranch]);
    await runGit(cwd, ["checkout", "-b", branchName]);
  }
}

export async function pushBranch(cwd: string, branchName: string): Promise<void> {
  await runGit(cwd, ["push", "-u", "origin", branchName]);
}

export async function appendCommitMetadataTrailers(
  cwd: string,
  runId: string,
  taskId: string,
  intentId: string
): Promise<void> {
  const message = [
    "chore(branchline): checkpoint",
    "",
    `X-Collab-Run-Id: ${runId}`,
    `X-Collab-Task-Id: ${taskId}`,
    `X-Collab-Intent-Id: ${intentId}`
  ].join("\n");

  await runGit(cwd, ["commit", "--allow-empty", "-m", message]);
}
