export type UUID = string;

export type OrgRole = "owner" | "admin" | "member" | "viewer";
export type ProjectRole = "admin" | "member" | "viewer";

export type TaskStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "review"
  | "done"
  | "archived";

export type BranchStatus = "active" | "stale" | "merged" | "closed" | "abandoned";
export type PrStatus = "open" | "draft" | "merged" | "closed";
export type QualityCheckKey =
  | "build"
  | "unit_tests"
  | "lint"
  | "dependency_audit"
  | "integration_tests";

export interface ProjectPolicyConfig {
  baseBranch: string;
  protectedBranches: string[];
  autoPush: boolean;
  autoPr: boolean;
  staleThresholdMinutes: number;
  cleanupAfterMergeHours: number;
  requiredQualityChecks: QualityCheckKey[];
  enforceGuardrailRecheckOnPromote: boolean;
}

export interface TaskRef {
  orgId: UUID;
  projectId: UUID;
  repoId: UUID;
  taskId: UUID;
  branchId?: UUID;
}

export interface BranchCreationRequest {
  taskSlug: string;
  ticketOrTask: string;
  baseBranch: string;
}

export interface BranchMetadataTrailer {
  runId: UUID;
  taskId: UUID;
  intentId: UUID;
}

export interface TimelineRow {
  id: UUID;
  taskId: UUID;
  timestamp: string;
  category: string;
  type: string;
  summary?: string;
}

export interface ActivityRow {
  id: UUID;
  projectId: UUID;
  userId: UUID;
  state: string;
  activeFilePath?: string | null;
  lastSeenAt: string;
}

export interface ConflictAction {
  id: string;
  label: string;
  action: "split" | "claim" | "rebase_hint" | "open_file" | "dismiss";
}

export interface ConflictSummary {
  id: UUID;
  projectId: UUID;
  taskId?: UUID | null;
  otherTaskId?: UUID | null;
  severity: "low" | "medium" | "high" | "critical";
  score: number;
  filePaths: string[];
  symbolNames: string[];
  reasonCodes?: string[];
  suggestedAction?: "split_work_or_rebase_before_merge" | "continue_with_watch";
  resolutionStatus: string;
}

export type GuardrailEvaluationStage = "pre_apply" | "pre_pr" | "promote";

export interface GuardrailEvaluationResult {
  status: "pass" | "warn" | "fail";
  stage: GuardrailEvaluationStage;
  blocking: boolean;
  reasonCodes: string[];
}

export interface HandoffSummary {
  id: UUID;
  taskId: UUID;
  summary: string;
  createdAt: string;
  ackCount?: number;
}

export interface ReplaySummary {
  taskId: UUID;
  snapshotVersion: number;
  generatedAt: string;
  steps: string[];
}
