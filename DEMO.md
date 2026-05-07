# Branchline v0.1 Demo (5 Minutes)

This script validates the wedge loop:

`login -> bindWorkspace -> startAiTask -> viewTimeline`

## 0) Prerequisites

1. `pnpm install`
2. `cp .env.example .env`
3. `docker compose -f infra/docker/docker-compose.yml up -d`
4. `pnpm --filter @branchline/api-server prisma:generate`
5. `pnpm --filter @branchline/api-server exec prisma migrate deploy`
6. `pnpm dev`

## 1) Web Onboarding (about 90 seconds)

1. Open `http://localhost:3000/onboarding`.
2. Create one organization.
3. Create one project.
4. Set active scope.

Expected result: onboarding success banners and scope selector set.

## 2) Extension Wedge Loop (about 2-3 minutes)

In VS Code with the Branchline extension loaded:

1. Run `Branchline: Login`.
2. Run `Branchline: Bind Workspace`.
3. Run `Branchline: Start AI Task`.
   1. Enter task title.
   2. Enter prompt.
   3. Enter AI output summary.
4. Run `Branchline: View Timeline`.

Expected result: markdown timeline opens with latest event showing commit/prompt/summary/files.

## 3) Web Timeline Check (about 30 seconds)

1. Open `http://localhost:3000/timeline`.
2. Select the task created above.
3. Click `Load Timeline`.

Expected result: latest 5 task-scoped events render as cards/list rows.

## 4) Smoke Command (optional quick verification)

Run:

```bash
pnpm smoke:wedge
```

This runs wedge API + web e2e + extension e2e checks.

## Pass Criteria

1. Full loop completes in under 5 minutes.
2. Captured fields are visible in both extension and web timeline.
3. No non-wedge navigation/command surfaces are required for the demo.
