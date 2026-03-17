# Branchline End-to-End Completion Plan

Status date: 2026-03-10  
Scope: Current codebase -> docs-complete MVP/V1 execution  
Execution mode: reliability-first, additive API changes, backward compatibility

## 1. Objective

Complete all documented features (`F1-F16`) so Branchline works end-to-end across:
1. `apps/api-server`
2. `apps/worker`
3. `apps/web-console`
4. `apps/vscode-extension`

Completion bar:
1. Each feature has one automated acceptance test.
2. Each feature has one scripted manual runbook.
3. Staging remains green for 5 consecutive days.
4. SLO, security, and restore-drill gates pass.

## 2. Current Baseline (Validated)

Implemented and validated now:
1. Local bootstrap and migrations work.
2. Core API task loop works: auth -> org/project/repo -> task -> branch -> intent -> quality -> handoff/replay/provenance/pivot.
3. Worker queues execute for intent, conflicts, guardrails, quality, PR slicing, handoff, notifications, analytics.
4. Integration connection lifecycle and OAuth endpoints exist (Slack/Linear/Jira).
5. Web console builds and runs.

Known gaps to close:
1. Web console is partial for several control-plane pages and deep operational dashboards.
2. Extension UX is still command-level, not full docs-complete collaboration UX.
3. Guardrails and conflict logic are functional but shallow versus full spec depth.
4. Quality gate orchestration needs policy depth and richer artifact/review flows.
5. Observability/reliability hardening is minimal.
6. Full E2E coverage is missing for web and extension.

## 3. What Was Completed Immediately (This Pass)

Implemented now:
1. Web auth robustness fallback when Clerk is not configured.
2. Removed runtime 500s for `/integrations`, `/sign-in`, `/sign-up` in non-Clerk local setups.
3. Added Clerk configuration helper and regression unit test.
4. Added realtime token route guard for missing Clerk config.

Files updated:
1. `apps/web-console/lib/clerk.ts`
2. `apps/web-console/middleware.ts`
3. `apps/web-console/app/layout.tsx`
4. `apps/web-console/lib/api.ts`
5. `apps/web-console/app/api/realtime-token/route.ts`
6. `apps/web-console/app/sign-in/[[...sign-in]]/page.tsx`
7. `apps/web-console/app/sign-up/[[...sign-up]]/page.tsx`
8. `apps/web-console/lib/clerk.test.ts`

## 4. Execution Plan (Locked Sequence)

### Phase 0: Platform and CI Hardening (Week 1)
1. Enforce required CI checks: `lint`, `typecheck`, `test`, `build`, migrations replay/drift.
2. Fail CI on placeholder/no-op scripts for required paths.
3. Add deterministic local/staging bootstrap scripts for infra + migrations + seed.
4. Add dependency and secret scanning gates with severity thresholds.

Exit criteria:
1. Fresh environment bootstrap succeeds from clean clone.
2. CI is fully blocking for all required checks.

### Phase 1: F1/F16 Auth, Tenancy, RBAC Completion (Weeks 1-2)
1. Finalize Clerk web session integration for all authenticated console routes.
2. Keep extension device flow + refresh rotation path stable.
3. Enforce membership-based org/project scope checks on every mutating endpoint.
4. Complete invite lifecycle and owner/admin safety checks.
5. Add session revocation/rotation telemetry and audits.

Exit criteria:
1. Unauthorized scope writes fail consistently.
2. Invite issue/accept/revoke/expire flows are fully tested.

### Phase 2: F2/F4/F15 GitHub Loop Completion (Weeks 2-3)
1. Complete GitHub App installation sync and metadata enrichment.
2. Harden webhook processing for installation, push, pull request, check run/suite events.
3. Ensure retry-safe, idempotent delivery processing with poison handling.
4. Enforce branch-to-PR automation via real GitHub API in production (no placeholder fallback).
5. Add reconciliation jobs for PR/branch merge state.

Exit criteria:
1. Production mode fails closed when GitHub App context is missing.
2. Webhook replay reproduces deterministic state.

### Phase 3: F3/F4 Extension Workflow Completion (Weeks 3-4)
1. Keep existing commands but add complete task workspace UX:
   1. timeline panel
   2. live activity/conflict panel
   3. handoff create/resume
   4. replay viewer
2. Enforce workspace/repo identity checks before task start.
3. Ensure branch orchestration idempotency and metadata trailer linkage server-side.
4. Add stale branch detection and cleanup worker by policy.

Exit criteria:
1. Extension can run the full task loop with no manual API calls.
2. Workspace mismatch is blocked before branch creation.

### Phase 4: F5/F14 Task, Intent, Timeline, Provenance Completion (Weeks 5-6)
1. Finalize task state machine and AI run linkage.
2. Keep intent envelope contract strict and monotonic per-task sequence.
3. Build complete timeline APIs and render in extension + web.
4. Link timeline to commits, PRs, quality runs, decisions, handoffs, conflicts.
5. Harden replay export format for audit tooling.

Exit criteria:
1. Reviewer can reconstruct task intent and outcomes quickly from timeline/provenance UI.

### Phase 5: F6/F7 Realtime Collaboration + Conflict Prevention (Weeks 6-7)
1. Keep locked WebSocket event set and ensure producer/consumer parity across API/web/extension.
2. Add robust presence TTL cleanup and room-based fanout.
3. Enhance conflict scoring using file overlap + symbol overlap + boundary overlap.
4. Add actionable extension guidance: split task, ownership claim, rebase suggestion, open files.

Exit criteria:
1. Realtime updates p95 under 2 seconds.
2. Conflict warnings are visible before merge stage.

### Phase 6: F8/F16 Guardrails, Redaction, Policy Enforcement (Week 7)
1. Complete policy set versioning + activation UX.
2. Finalize `.branchline/policy.yaml` ingestion/normalization.
3. Enforce guardrails pre-apply (extension) and pre-PR (worker/backend).
4. Apply redaction policy at ingest for sensitive prompt/code payload fields.

Exit criteria:
1. Policy violations block or warn at the right stage with clear error context.

### Phase 7: F10/F11 Quality Gates + PR Review Workflow (Week 8)
1. Keep command-driven worker and add required-check policy by project/repo.
2. Persist per-check logs/artifacts with retention class and lookup APIs.
3. Complete PR slicer/digest generation using intent/activity/conflict/quality signals.
4. Enforce merge-block when required checks fail.

Exit criteria:
1. Required quality failures block promotion/merge path.
2. PR digest/slices are available for reviewer workflow.

### Phase 8: F9/F13/F14/F16 Handoff, Pivot, Audit Completion (Weeks 9-10)
1. Complete one-click handoff generation payload with structured sections.
2. Add handoff acknowledge/resume in web and extension.
3. Finish pivot mode stale reports with migration suggestions.
4. Verify immutable audit hash-chain and tamper-check endpoint on schedule.
5. Add retention jobs and archival pointers for high-volume tables/artifacts.

Exit criteria:
1. Teammate can resume from handoff without direct chat.
2. Audit export + verification succeeds for sample merged tasks.

### Phase 9: F12/F15/F16 Integrations, Analytics, Reliability, Scale (Weeks 11-20)
1. Complete Slack/Linear/Jira OAuth + link/unlink + health status flows.
2. Add notification delivery callbacks and retry visibility.
3. Add prompt template adoption analytics and dashboards.
4. Add OpenTelemetry, Sentry, Prometheus, structured logs, SLO dashboards.
5. Implement queue retries/DLQ/backfill tools and load-test hardening.
6. Run failover and backup/restore drills.

Exit criteria:
1. Performance and security gates meet documented thresholds.
2. Staging remains green for 5 consecutive days.

## 5. Feature-to-Phase Map

1. `F1` -> Phase 1
2. `F2` -> Phase 2
3. `F3` -> Phase 3
4. `F4` -> Phases 2 and 3
5. `F5` -> Phase 4
6. `F6` -> Phase 5
7. `F7` -> Phase 5
8. `F8` -> Phase 6
9. `F9` -> Phase 8
10. `F10` -> Phase 7
11. `F11` -> Phase 7
12. `F12` -> Phase 9
13. `F13` -> Phase 8
14. `F14` -> Phases 4 and 8
15. `F15` -> Phases 2 and 9
16. `F16` -> Phases 1, 6, 8, and 9

## 6. Validation Plan (Required)

### Unit Tests
1. RBAC scope resolution.
2. Invite expiry/accept/revoke and owner safety checks.
3. Branch naming/protection/idempotency.
4. Guardrail parser and evaluator logic.
5. Conflict scoring.
6. Redaction pipeline behavior.
7. Audit hash-chain verification logic.

### Integration Tests
1. GitHub installation sync + webhook verify/retry.
2. Task start -> branch -> intent -> quality -> PR update.
3. Guardrail failure path and merge-block behavior.
4. Pivot stale report generation.
5. Handoff create/ack/resume flow.

### Web and Extension E2E
1. Web: authenticated org/project/team/repo/policy/integration management.
2. Web: realtime activity and conflict dashboard updates.
3. Extension: login refresh lifecycle, workspace binding, protected-branch block.
4. Extension: auto-branch/auto-PR, intent sequence, conflict warning, guardrail pre-apply block, handoff resume.

### Performance and Security
1. Realtime propagation p95 `< 2s`.
2. Branch creation median `< 5s`.
3. 50k intent events/day simulation.
4. 5k quality runs/day simulation.
5. RBAC denial matrix.
6. Webhook signature rejection.
7. Token rotation/expiry checks.
8. Secret leakage and redaction verification.

## 7. Release Gates

MVP completion gate:
1. F1-F11 acceptance checks passing.
2. Pilot flow works end-to-end for one partner.

V1 completion gate:
1. F1-F16 acceptance checks passing.
2. Staging green 5 consecutive days.
3. No critical vulnerabilities.
4. Successful backup/restore drill.
5. SLO dashboards within target thresholds.

## 8. Immediate Next Sprint Backlog

1. Web console Clerk-first authenticated route enforcement cleanup.
2. Production fail-closed auto-PR behavior validation path with GitHub App.
3. Extension timeline + handoff resume UX surfaces.
4. Guardrail rule expansion beyond path-prefix checks.
5. Quality gate required-check policy and PR merge-block integration.
6. Web and extension E2E suites wired into CI.
