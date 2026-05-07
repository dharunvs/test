# Hard Pivot Execution Plan (14 Days)

Version: 1.1
Date: 2026-03-17
Audience: Engineering, Product, Founders
Status: Implemented with validation closure pending

## Summary

This plan executes the hard pivot end-to-end around one wedge: **AI Intent Timeline**.

## Phase 0 (Day 0-2): Scope Cut + Onboarding Reliability

### Objectives

1. publish wedge-only positioning
2. remove non-wedge runtime paths
3. enforce one local bootstrap path and one smoke command

### Completion Checklist

- [x] README updated to wedge-only message
- [x] onboarding env defaults aligned (`.env.example`, docker compose, bootstrap script)
- [x] non-wedge web pages removed
- [x] non-wedge extension commands removed
- [x] non-wedge API modules removed from runtime registration
- [x] schema cleanup deferred (no destructive table drops)

## Phase 1 (Day 3-7): Wedge Runtime (API + Extension + Web)

### API

- [x] `POST /v1/intent` simplified payload contract
- [x] `GET /v1/intent?taskId=<uuid>&limit=5` task-scoped read path
- [x] org/project scope derived from task lookup
- [x] Postgres-backed `IntentEvent` storage only
- [x] always-on baseline redaction + policy additive behavior
- [x] queue narrowed to `queue.intent.normalize`

### Extension

- [x] runtime commands narrowed to login/bind/start/view timeline
- [x] `startAiTask` simplified to task/branch + intent capture payload
- [x] offline-safe capture queue in workspace state
- [x] `viewTimeline` reads last 5 entries and flushes pending queue first

### Web

- [x] primary `/timeline` page added
- [x] timeline shows task selector + last 5 intent cards
- [x] top navigation reduced to wedge essentials
- [x] onboarding and project scope flows preserved

## Phase 2 (Day 7-14): Delivery Gates + Validation Assets

### Delivery and CI

- [x] feature gates pivoted from F1-F16 to W1-W5
- [x] gate verification script uses manifest-driven feature list
- [x] CI required path narrowed to wedge checks + wedge web e2e + wedge extension e2e
- [x] legacy live/signoff jobs removed from required path

### Validation Assets

- [x] `DEMO.md` added for 5-minute walkthrough
- [x] feedback logging template added for 5-team interviews
- [x] docs precedence updated to pivot-first order

## Acceptance Test Plan

### API

1. `POST /v1/intent` accepts valid payload and rejects invalid payload.
2. `GET /v1/intent` returns latest task-scoped events in stable shape.
3. redaction policy tests cover baseline pattern behavior.

### Extension

1. command registry exposes only 4 wedge commands.
2. e2e loop verifies `login -> bind -> startAiTask -> viewTimeline`.
3. offline queue retries on subsequent actions.

### Web

1. onboarding and scope selection are functional.
2. `/timeline` renders task-scoped latest events.
3. non-wedge navigation links are absent.

### Performance / Usability

1. timeline read path targets sub-200ms p95 for `limit=5` in local/staging benchmarks.
2. benchmark command: `pnpm benchmark:intent-read -- --taskId=<task-uuid> --iterations=50 --thresholdMs=200`.
3. demo walkthrough repeatably completes under 5 minutes.

## Final Go/No-Go Step

Run the 5-team interviews using `05_feedback_log_template.md`.

Decision rule:

1. Continue only if at least 3 of 5 teams report yes on save-time, keep-using, and willingness-to-pay.
