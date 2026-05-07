# Branchline

v0.1 focuses ONLY on Intent Timeline.
All other features are disabled or deferred until wedge validation.

Branchline v0.1 includes:
- Web timeline console (`apps/web-console`)
- API for onboarding, task start, branch create, and intent capture (`apps/api-server`)
- Intent normalization worker (`apps/worker`)
- VS Code extension wedge flow (`apps/vscode-extension`)

## Quick start

1. Install dependencies:
   - `pnpm install`
2. Copy envs:
   - `cp .env.example .env`
3. Start local infra:
   - `docker compose -f infra/docker/docker-compose.yml up -d`
4. Generate Prisma client and run migrations:
   - `pnpm --filter @branchline/api-server prisma:generate`
   - `pnpm --filter @branchline/api-server exec prisma migrate deploy`
5. Run all apps in dev mode:
   - `pnpm dev`
6. Run wedge smoke (optional):
   - `pnpm smoke:wedge`
7. Run timeline p95 benchmark (optional, requires an existing task id):
   - `pnpm benchmark:intent-read -- --taskId=<task-uuid> --iterations=50 --thresholdMs=200`

## Authentication (dev)

1. Web console supports Clerk sessions (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) or GitHub OAuth (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`).
2. Middleware protects all console routes except auth entry/callback pages.
3. Server components/actions forward auth tokens to the API (Clerk token template optional: `CLERK_API_TOKEN_TEMPLATE`).
4. VS Code extension continues to use device-style auth flow against `/v1/auth/device/*`.

### GitHub OAuth fallback (without Clerk)

If you do not want to configure Clerk in local dev, you can enable GitHub OAuth sign-in:

1. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.env`.
2. Add GitHub OAuth callback URL: `http://localhost:3000/api/auth/github/callback`.
3. Restart `apps/web-console` and `apps/api-server`.
4. Open `/sign-in` and use `Continue with GitHub`.

## v0.1 Wedge Loop

1. `Branchline: Login`
2. `Branchline: Bind Workspace`
3. `Branchline: Start AI Task`
4. `Branchline: View Timeline`

## Workspace Layout

- `apps/*`: deployable applications
- `packages/*`: shared libraries
- `infra/*`: infrastructure definitions
- `docs/*`: pivot and archived planning docs
