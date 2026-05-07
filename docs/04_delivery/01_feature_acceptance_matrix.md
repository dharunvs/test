# Branchline Feature Acceptance Matrix (W1-W5)

Status date: 2026-03-17

## Purpose

This matrix maps each wedge feature (`W1-W5`) to:
1. at least one automated check, and
2. one scripted manual validation path.

## Matrix

| Feature | Automated Coverage | Manual Validation Runbook |
| --- | --- | --- |
| W1 Onboarding | `pnpm --filter @branchline/web-console e2e -- e2e/smoke.e2e.ts` (onboarding create org -> create project) | `MR-W1-ONBOARDING` |
| W2 Intent capture API | `apps/api-server/test/intent.controller.spec.ts` (`POST /v1/intent` validation + persistence behavior) | `MR-W2-INTENT-CAPTURE` |
| W3 Timeline read UX | `pnpm --filter @branchline/web-console e2e -- e2e/smoke.e2e.ts` (timeline page renders task-scoped events) | `MR-W3-TIMELINE-READ` |
| W4 Redaction | `apps/api-server/test/redaction.policy.spec.ts` (pattern and field redaction behavior) | `MR-W4-REDACTION-VERIFY` |
| W5 Extension wedge loop | `apps/vscode-extension/e2e/suite/extension.e2e.cjs` (login/bind/start/view flow) | `MR-W5-EXTENSION-LOOP` |

## Manual Validation Script (Condensed)

1. Start infra and apps (`pnpm install`, `docker compose -f infra/docker/docker-compose.yml up -d`, `pnpm dev`).
2. Complete onboarding in web and set active scope.
3. Run extension wedge flow and capture an intent event.
4. Open `/timeline` and verify last 5 task events render correctly.
5. Execute redaction verification payload and confirm sanitized output.
