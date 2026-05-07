# ADR-2026-03-17: Hard Pivot To AI Intent Timeline

Version: 1.1
Date: 2026-03-17
Audience: Founders, Product, Engineering
Status: Accepted and Implemented for v0.1 runtime

## Decision

Branchline v0.1 ships only one wedge: **AI Intent Timeline**.

The product loop is:

1. login
2. bind workspace
3. start AI task
4. capture intent (`prompt`, `summary`, `files`, `commitId`)
5. read task-scoped timeline

## Locked Scope Rules

1. Non-wedge runtime paths are removed from active runtime surfaces (not just hidden).
2. Timeline is task-scoped only in v0.1.
3. Storage is Postgres (`IntentEvent`) only; no memory mode.
4. Database table cleanup is deferred (no risky schema drops in v0.1).

## Why

The prior platform scope was too broad before proving user value. This pivot reduces risk and forces fast learning with real teams.

## Success Bar

v0.1 is successful only if all are true:

1. A developer can complete `login -> bindWorkspace -> startAiTask -> viewTimeline` in under 5 minutes.
2. Timeline read path is fast and stable.
3. 5-team validation is completed with a clear go/no-go recommendation.

## Go/No-Go Interview Rule

A positive wedge signal requires at least 3 of 5 teams answering "yes" to all:

1. Did this save time?
2. Would you keep using this?
3. Would you pay for this?

## Deferred Until After Validation

1. conflict prevention and ownership workflows
2. handoff/replay/provenance expansion
3. integrations and notification expansion
4. quality/policy surface expansion not directly required by wedge
5. project knowledge hub expansion
