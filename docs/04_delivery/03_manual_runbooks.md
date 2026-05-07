# Branchline Manual Runbooks (W1-W5)

Status date: 2026-03-17

## MR-W1-ONBOARDING
1. Start stack and open web console.
2. Create organization.
3. Create project.
4. Set active scope and verify selected project persists.

## MR-W2-INTENT-CAPTURE
1. Open VS Code with extension.
2. Run `Branchline: Login`.
3. Run `Branchline: Bind Workspace`.
4. Run `Branchline: Start AI Task` with prompt and AI summary.
5. Verify API accepts `POST /v1/intent` payload.

## MR-W3-TIMELINE-READ
1. Open `/timeline` in web console.
2. Select task from task dropdown.
3. Verify exactly the latest intent events are visible with:
   - commit
   - prompt
   - summary
   - files

## MR-W4-REDACTION-VERIFY
1. Submit intent payload containing sample email, API key, and secret-like token.
2. Fetch timeline via `GET /v1/intent?taskId=<id>&limit=5`.
3. Verify sensitive strings are redacted and `redactionLevel=partial` when expected.

## MR-W5-EXTENSION-LOOP
1. Complete extension wedge flow end-to-end:
   - login
   - bindWorkspace
   - startAiTask
   - viewTimeline
2. Simulate temporary API outage and trigger intent capture.
3. Restore API and run `viewTimeline` again.
4. Verify queued capture flushes and appears in timeline.
