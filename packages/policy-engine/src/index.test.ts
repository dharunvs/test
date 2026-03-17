import { describe, expect, it } from "vitest";

import { evaluateGuardrails, normalizePolicy } from "./index.js";

describe("policy-engine", () => {
  it("normalizes policy defaults", () => {
    const policy = normalizePolicy({});
    expect(policy.baseBranch).toBe("main");
    expect(policy.protectedBranches).toContain("main");
    expect(policy.requiredQualityChecks).toEqual([
      "build",
      "unit_tests",
      "lint",
      "dependency_audit"
    ]);
    expect(policy.enforceGuardrailRecheckOnPromote).toBe(true);
  });

  it("reports banned prefix violations", () => {
    const violations = evaluateGuardrails({
      changedPaths: ["infra/secrets.tf", "src/app.ts"],
      bannedPathPrefixes: ["infra/"]
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("banned-path-prefix");
  });

  it("reports max changed file violations", () => {
    const violations = evaluateGuardrails({
      changedPaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
      maxChangedFiles: 2
    });

    expect(violations.some((violation) => violation.ruleKey === "max-changed-files")).toBe(true);
  });

  it("reports forbidden regex path violations", () => {
    const violations = evaluateGuardrails({
      changedPaths: ["src/admin/root.ts", "src/app.ts"],
      forbiddenPathPatterns: ["^src/admin/"]
    });

    expect(violations.some((violation) => violation.ruleKey === "forbidden-path-pattern")).toBe(true);
  });

  it("reports companion path requirement violations", () => {
    const violations = evaluateGuardrails({
      changedPaths: ["src/api/users.ts"],
      companionPathRequirements: [
        {
          whenPathPrefix: "src/api/",
          requireAnyPathPrefixes: ["contracts/"],
          ruleKey: "api-contract-sync"
        }
      ]
    });

    expect(violations.some((violation) => violation.ruleKey === "api-contract-sync")).toBe(true);
  });
});
