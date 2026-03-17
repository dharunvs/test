import type { ProjectPolicyConfig } from "@branchline/shared-types";

export interface GuardrailViolation {
  ruleKey: string;
  severity: "warn" | "fail";
  message: string;
}

export interface GuardrailInput {
  changedPaths: string[];
  bannedPathPrefixes?: string[];
  requiredPathPrefix?: string;
  maxChangedFiles?: number;
  forbiddenPathPatterns?: string[];
  companionPathRequirements?: CompanionPathRequirement[];
}

export interface CompanionPathRequirement {
  ruleKey?: string;
  severity?: "warn" | "fail";
  whenPathPrefix: string;
  requireAnyPathPrefixes: string[];
}

export function normalizePolicy(policy: Partial<ProjectPolicyConfig>): ProjectPolicyConfig {
  return {
    baseBranch: policy.baseBranch ?? "main",
    protectedBranches: policy.protectedBranches ?? ["main", "develop", "release"],
    autoPush: policy.autoPush ?? false,
    autoPr: policy.autoPr ?? true,
    staleThresholdMinutes: policy.staleThresholdMinutes ?? 120,
    cleanupAfterMergeHours: policy.cleanupAfterMergeHours ?? 24,
    requiredQualityChecks:
      policy.requiredQualityChecks && policy.requiredQualityChecks.length > 0
        ? policy.requiredQualityChecks
        : ["build", "unit_tests", "lint", "dependency_audit"],
    enforceGuardrailRecheckOnPromote:
      policy.enforceGuardrailRecheckOnPromote ?? true
  };
}

export function evaluateGuardrails(input: GuardrailInput): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  if (
    typeof input.maxChangedFiles === "number" &&
    Number.isFinite(input.maxChangedFiles) &&
    input.maxChangedFiles > 0 &&
    input.changedPaths.length > input.maxChangedFiles
  ) {
    violations.push({
      ruleKey: "max-changed-files",
      severity: "fail",
      message: `Changed ${input.changedPaths.length} files, exceeding max ${input.maxChangedFiles}`
    });
  }

  if (input.bannedPathPrefixes?.length) {
    for (const path of input.changedPaths) {
      for (const bannedPrefix of input.bannedPathPrefixes) {
        if (path.startsWith(bannedPrefix)) {
          violations.push({
            ruleKey: "banned-path-prefix",
            severity: "fail",
            message: `Path ${path} violates banned prefix ${bannedPrefix}`
          });
        }
      }
    }
  }

  if (input.requiredPathPrefix) {
    for (const path of input.changedPaths) {
      if (!path.startsWith(input.requiredPathPrefix)) {
        violations.push({
          ruleKey: "required-path-prefix",
          severity: "warn",
          message: `Path ${path} does not match required prefix ${input.requiredPathPrefix}`
        });
      }
    }
  }

  if (input.forbiddenPathPatterns?.length) {
    for (const pattern of input.forbiddenPathPatterns) {
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        violations.push({
          ruleKey: "invalid-forbidden-path-pattern",
          severity: "fail",
          message: `Invalid forbidden path pattern: ${pattern}`
        });
        continue;
      }

      for (const path of input.changedPaths) {
        if (regex.test(path)) {
          violations.push({
            ruleKey: "forbidden-path-pattern",
            severity: "fail",
            message: `Path ${path} matches forbidden pattern ${pattern}`
          });
        }
      }
    }
  }

  if (input.companionPathRequirements?.length) {
    for (const requirement of input.companionPathRequirements) {
      const triggers = input.changedPaths.filter((path) => path.startsWith(requirement.whenPathPrefix));
      if (triggers.length === 0) {
        continue;
      }

      const hasCompanion = input.changedPaths.some((path) =>
        requirement.requireAnyPathPrefixes.some((prefix) => path.startsWith(prefix))
      );

      if (!hasCompanion) {
        violations.push({
          ruleKey: requirement.ruleKey ?? "companion-path-requirement",
          severity: requirement.severity ?? "fail",
          message: `Changes under ${requirement.whenPathPrefix} require companion changes under one of: ${requirement.requireAnyPathPrefixes.join(", ")}`
        });
      }
    }
  }

  return violations;
}
