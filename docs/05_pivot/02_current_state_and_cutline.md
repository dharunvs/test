# Current State And Runtime Cutline (v0.1)

Version: 1.1
Date: 2026-03-17
Audience: Product, Engineering
Status: Implemented baseline

## Runtime Surfaces Kept (Wedge-Critical)

### API (`apps/api-server`)

Active modules in `src/app.module.ts`:

1. `auth`
2. `organizations`
3. `projects`
4. `repositories`
5. `workspace-bindings`
6. `tasks`
7. `branches`
8. `intent`

Active queue topic:

1. `queue.intent.normalize`

### VS Code Extension (`apps/vscode-extension`)

Active commands:

1. `branchline.login`
2. `branchline.bindWorkspace`
3. `branchline.startAiTask`
4. `branchline.viewTimeline`

### Web Console (`apps/web-console`)

Active navigation:

1. Overview
2. Onboarding
3. Projects
4. Timeline

Primary wedge page:

1. `/timeline` (task selector + latest 5 intent events)

### Worker (`apps/worker`)

Active processor scope:

1. intent normalization queue only

## Runtime Surfaces Removed From Active Path

### API runtime registration removed

Non-wedge modules are no longer imported in `AppModule` (activity, conflicts, handoffs, replay, provenance, pivot, guardrails, quality-gates, prompt-library, integrations, notifications, realtime, audit, project-knowledge, and others).

### API endpoint cuts

1. task controller now keeps only `start`, `list`, `get`
2. branch controller keeps only `create`
3. non-wedge task/branch operations (handoffs/conflicts/pr-slices/review-digest/promote/merge/etc.) removed from active runtime paths

### Extension runtime cuts

Removed command registrations and related providers for:

1. handoff create/acknowledge
2. replay
3. conflict/ownership claim
4. activity/panel/realtime wiring

### Web runtime cuts

Removed non-wedge pages and links (activity, pivot, quality, prompts, integrations, provenance, replay, audit, team, repository ops, project knowledge, policy, tasks page).

## Data/Schema Policy For v0.1

1. Intent events remain persisted in Postgres (`IntentEvent`).
2. Existing non-wedge tables are retained for compatibility.
3. Destructive schema cleanup is deferred until after wedge validation.

## Redaction Policy Baseline

Intent capture applies always-on baseline redaction for:

1. API key-like tokens
2. secret/token-like fields
3. email addresses

Org policy patterns are additive on top of baseline patterns.

## Known Deferred Items

1. project-wide aggregate timeline feed
2. non-wedge feature reactivation
3. risky DB table deletion/migration cleanup
