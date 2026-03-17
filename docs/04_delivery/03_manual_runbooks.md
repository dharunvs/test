# Branchline Manual Runbooks (F1-F16)

Status date: 2026-03-12

## MVP-LIVE-PREREQUISITES-CONTRACT
Canonical contract:
1. `docs/04_delivery/04_live_input_contract.json` is the single source of truth for strict-lane live prerequisites.

Validation command (strict, no skips):
1. `pnpm live:preflight --strict --lane=nightly --gitSha=<git-sha> --contract=docs/04_delivery/04_live_input_contract.json --output=artifacts/live-e2e/live-prereqs-static.json`
2. Probe-enabled validation: `pnpm live:preflight --strict --probe-api --probe-github-status --fixtures=artifacts/live-e2e/fixtures.json --lane=nightly --gitSha=<git-sha> --contract=docs/04_delivery/04_live_input_contract.json --output=artifacts/live-e2e/live-prereqs-probe.json`
3. CI secrets required for strict nightly/RC: `BRANCHLINE_STAGING_API_BASE_URL`, `AUTH_JWT_SECRET`, `GITHUB_WEBHOOK_SECRET`, `BRANCHLINE_SMOKE_BEARER_TOKEN`, `BRANCHLINE_GITHUB_INSTALLATION_ID`, `BRANCHLINE_LIVE_ORG_ID`, `BRANCHLINE_LIVE_PROJECT_ID`.
4. If either strict preflight command fails, treat iteration as blocked (no strict signoff run until fixed).

## MVP-STRICT-STAGING-GATE
Strict gate command (no manual API patching, no skipped steps):
1. `pnpm mvp:gate:live --lane=nightly --outputRoot=artifacts/mvp-gate`
2. Verify gate status is `passed` in `gate-summary.json`.
3. Verify artifact bundle contains: `gate-summary.json`, `pilot-flow.json`, `staging-checks.json`, `pilot-kpis.json`, `github-sandbox-smoke.json`, `live-prereqs.json`, and per-step logs.
4. Verify `staging-gate-summary.json` reports no artifact validation errors.

## MVP-STRICT-SIGNOFF-ITERATION
Single-iteration strict evidence run:
1. `pnpm mvp:signoff:iteration --strict --nightlyRuns=3 --gitSha=<git-sha> --outputRoot=artifacts/mvp-signoff --gateOutputRoot=artifacts/mvp-gate-signoff`
2. Confirm run matrix includes `nightly-1`, `nightly-2`, `nightly-3`, `rc-1`, and `partner-pilot`.
3. Confirm all required runs are green in `mvp-signoff-index.json`.
4. Confirm checklist exists at `mvp-signoff-checklist.md`.
5. Confirm `release-signoff-bundle.json` exists and includes all run IDs and artifact integrity results.

## MVP-CI-RELEASE-CHECKLIST
Nightly/RC signoff requires:
1. `live_stack_provider_smoke` job green with no skipped required steps.
2. Static and probe preflight checks pass before strict gate (`live-prereqs-static.json`, `live-prereqs-probe.json`).
3. Uploaded artifacts contain complete strict-gate evidence bundle from the same run ID.
4. Branch protection/release checklist references `checks`, `e2e_web`, `e2e_extension`, and `live_stack_provider_smoke` as required gates before release signoff.
5. Optional workflow dispatch: set `run_mvp_signoff_iteration=true` to generate one strict MVP signoff iteration bundle.
6. Final signoff requires `strictMvpSignoff=true` in `mvp-signoff-index.json` and `evidenceIntegrityPassed=true`.

## MR-F1-ONBOARD-TEAM
1. Sign in to console.
2. Create org/project.
3. Invite teammate and verify role-scoped access.

## MR-F2-GITHUB-INSTALL-SYNC
1. Install GitHub App.
2. Run installation sync.
3. Verify installation status and repository mapping.

## MR-F3-EXTENSION-LOGIN-BIND
1. Login via extension device flow.
2. Bind workspace org/project/repo.
3. Restart VS Code and verify binding persists.

## MR-F4-START-TASK-BRANCH-PR
1. Start AI task from extension.
2. Verify protected branch block and AI branch creation.
3. Verify PR ensure result and branch automation status.

## MR-F5-INTENT-TIMELINE-REVIEW
1. Emit task intent events.
2. Open timeline API/UI with `includeRelated=true`.
3. Verify intent + decisions + quality + handoff + conflicts linkage.

## MR-F6-LIVE-ACTIVITY-STREAM
1. Open two clients on same project.
2. Publish presence/file focus updates.
3. Verify websocket updates and stale marker behavior.

## MR-F7-CONFLICT-CENTER-ACTIONS
1. Score a conflict with overlapping files/symbols.
2. Verify conflict appears in extension conflict center.
3. Run claim/open-file actions and verify ownership claim persistence.

## MR-F8-POLICY-YAML-INGEST-EVAL
1. Ingest `.branchline/policy.yaml`.
2. Evaluate changed paths against active policy.
3. Verify pass/warn/fail and violation details.

## MR-F9-PIVOT-STALE-CONTEXT
1. Enable pivot mode.
2. Verify stale reports generated for tasks/branches.
3. Verify realtime `pivot.mode_enabled` event propagation.

## MR-F10-PR-SLICE-DIGEST
1. Run quality gate for task with intent history.
2. Verify PR slices generated and risk grouping output.
3. Validate reviewer digest in task workflow.

## MR-F11-QUALITY-REQUIRED-CHECKS
1. Trigger quality run with required checks.
2. Verify failed checks block promote/merge.
3. Verify passing checks unblock promote/merge.

## MR-F12-PROMPT-ADOPTION-ANALYTICS
1. Create prompt template and new version.
2. Record prompt usage events.
3. Verify usage analytics aggregation by template/version.

## MR-F13-HANDOFF-RESUME
1. Generate handoff packet from task.
2. Acknowledge from second user.
3. Resume using handoff + replay context.

## MR-F14-REPLAY-AUDIT-EXPORT
1. Build replay snapshot for task.
2. Export replay report.
3. Verify provenance entities and digest in output.

## MR-F15-SLACK-LINEAR-JIRA-CONNECT
1. Start OAuth for Slack/Linear/Jira.
2. Complete callback and verify connection status.
3. Reauthorize/unlink and verify state transitions.

## MR-F16-POLICY-RETENTION-VERIFY
1. Configure redaction + retention policy.
2. Execute retention run and audit export/verify.
3. Validate audit hash chain and tamper-check endpoint.
