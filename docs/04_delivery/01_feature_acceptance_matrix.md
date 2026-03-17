# Branchline Feature Acceptance Matrix (F1-F16)

Status date: 2026-03-11

## Purpose

This matrix maps each documented feature (`F1-F16`) to:
1. at least one automated check, and
2. one scripted manual validation path.

## Matrix

| Feature | Automated Coverage | Manual Validation Runbook |
| --- | --- | --- |
| F1 Auth/org/project/team | `apps/api-server/test/memberships.controller.spec.ts` (invite/project membership authorization checks) | Create org -> create project -> invite member -> accept invite -> verify role-limited endpoint access |
| F2 GitHub App linking | `apps/api-server/test/github-app.controller.spec.ts` (webhook idempotency, signature rejection, retry scheduling, max-attempt fail-permanent, reconcile fail-closed) | Install app in GitHub, run sync without repo payload, verify repos appear in project bindings |
| F3 Extension login/binding | Extension command flow with refresh token rotation (`branchline.login`, `branchline.bindWorkspace`) | Login once, restart VS Code, verify task start works without re-login |
| F4 Branch orchestration | `apps/api-server/test/branches.service.spec.ts`, `apps/api-server/test/branches.policy-sweep.spec.ts`, `apps/api-server/test/branches.ensure-pr.spec.ts`, `apps/api-server/test/branches.promote.spec.ts` | Start AI task, confirm protected-branch block, auto-branch naming, stale-scan and cleanup endpoints |
| F5 Shared intent timeline | API contract: `POST /intent/events`, `GET /intent/timeline?includeRelated=true` | Start task, emit intent, verify timeline includes intent + decisions + quality/handoff/conflict records |
| F6 Live team activity map | `apps/api-server/test/activity.controller.spec.ts` (presence upsert + realtime event emission path) | Open two clients, verify presence updates within 2 seconds and event feed updates in web console |
| F7 Conflict prevention engine | `apps/api-server/test/conflicts.controller.spec.ts` (score + queue + realtime + ownership claim flows) | Simulate overlapping files, verify conflict warning in extension and claim workflow |
| F8 Guardrails | `apps/api-server/test/guardrails.controller.spec.ts` (policy evaluate stage + blocking + queue dispatch path) | Ingest `.branchline/policy.yaml`, run evaluation with violating paths, verify fail/warn handling |
| F9 Pivot mode | `apps/api-server/test/pivot.controller.spec.ts` (`POST /pivot/enable` stale report + realtime + analytics path) | Trigger pivot, verify stale reports for active tasks/branches and realtime `pivot.mode_enabled` |
| F10 PR slicer + digest | `apps/api-server/test/quality-gates.controller.spec.ts` (quality run queues `queue.pr.slice` with task/run context) | Run quality gate on task with intent events, verify slice entries and risk grouping |
| F11 Quality gates | Worker `queue.quality.run` executes command-based checks and persists check artifacts; branch promotion gate enforced via `POST /branches/:id/promote` and `apps/api-server/test/branches.promote.spec.ts` | Run quality gate with build/test/lint commands; verify failed checks block promotion (`quality_required_checks_failed`) |
| F12 Prompt library | `apps/api-server/test/prompt-library.controller.spec.ts` (version lifecycle + usage analytics aggregation) | Create templates, reuse in tasks, inspect usage telemetry in DB/analytics rollups |
| F13 Handoff packets | `apps/api-server/test/handoffs.controller.spec.ts` (handoff create + queue + ack upsert flow) | Generate handoff, acknowledge from second user, resume task using packet details |
| F14 Replay/provenance | Replay APIs (`/replay/:taskId`, `/replay/:taskId/export`), provenance graph API (`/provenance/graph`), commit metadata ingestion (`/intent/commit-metadata`), `apps/api-server/test/provenance.controller.spec.ts` | Link commit trailers from extension, export replay report, verify digest and linked entities |
| F15 Integrations | Integrations connections/links lifecycle + health/unlink/rotation APIs (`/integrations/connections/:id/health`, `/integrations/connections/:id/unlink`, `/integrations/connections/:id/rotate`) + `apps/api-server/test/integrations.controller.spec.ts` | Connect Slack/Linear/Jira records, link task entity, verify health status and unlink behavior |
| F16 Access/policy/audit controls | `apps/api-server/test/audit.hash.spec.ts`, `apps/api-server/test/redaction.policy.spec.ts`, `apps/api-server/test/workspace-bindings.controller.spec.ts`, audit export/verify/tamper-check endpoints, immutable trigger migration, redaction/retention policy APIs | Attempt unauthorized action, confirm denial; verify audit hash chain and immutability protection |

## Manual Validation Script (Condensed)

1. Start infra (`docker compose -f infra/docker/docker-compose.yml up -d`).
2. Run migrations and services (`pnpm --filter @branchline/api-server exec prisma migrate deploy`, `pnpm dev`).
3. Execute end-to-end pilot flow:
   - Preferred executable check: `pnpm mvp:pilot-flow`.
   - Create org/project and policy.
   - Sync GitHub installation.
   - Login and bind extension workspace.
   - Start AI task and verify branch/provenance metadata.
   - Emit activity and conflict events from two clients.
   - Run guardrail + quality checks.
   - Generate handoff and replay export.
   - Trigger pivot and verify stale context report.
   - Export and verify audit logs.
4. Record results in release checklist before staging promotion.
