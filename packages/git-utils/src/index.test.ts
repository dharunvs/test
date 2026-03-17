import { describe, expect, it } from "vitest";

import { buildMetadataTrailers, buildTaskBranchName, isProtectedBranch } from "./index.js";

describe("git-utils", () => {
  it("builds deterministic task branch names", () => {
    const branch = buildTaskBranchName({
      ticketOrTask: "HB-42",
      taskSlug: "Implement branch orchestrator",
      timestamp: new Date("2026-03-09T10:30:00Z")
    });

    expect(branch).toBe("ai/hb-42/implement-branch-orchestrator-20260309T103000Z");
  });

  it("detects protected branches", () => {
    expect(isProtectedBranch("main", ["main", "develop"])) .toBe(true);
    expect(isProtectedBranch("feature/x", ["main", "develop"])) .toBe(false);
  });

  it("creates metadata trailers", () => {
    const trailers = buildMetadataTrailers("run-1", "task-1", "intent-1");
    expect(trailers).toContain("X-Collab-Run-Id: run-1");
    expect(trailers).toContain("X-Collab-Task-Id: task-1");
    expect(trailers).toContain("X-Collab-Intent-Id: intent-1");
  });
});
