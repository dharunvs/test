# Branchline

Branchline is an AI-native team coding platform with:
- Web control plane (`apps/web-console`)
- API and orchestration backend (`apps/api-server`)
- Worker services (`apps/worker`)
- VS Code execution plane extension (`apps/vscode-extension`)

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

## Authentication (dev)

1. Web console uses Clerk sessions (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`).
2. Middleware protects all console routes except Clerk auth pages.
3. Server components/actions forward Clerk JWTs to the API (`CLERK_API_TOKEN_TEMPLATE` optional).
4. VS Code extension continues to use device-style auth flow against `/v1/auth/device/*`.

## Workspace layout

- `apps/*`: deployable applications
- `packages/*`: shared libraries
- `infra/*`: infrastructure definitions
- `docs/*`: strategy, product, and technical plans
