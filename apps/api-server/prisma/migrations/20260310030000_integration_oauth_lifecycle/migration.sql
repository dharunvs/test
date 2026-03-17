-- AlterTable
ALTER TABLE "IntegrationConnection"
  ADD COLUMN "authType" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "oauthScopes" JSONB,
  ADD COLUMN "oauthMetadata" JSONB,
  ADD COLUMN "tokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "refreshExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorCode" TEXT,
  ADD COLUMN "lastErrorMessage" TEXT,
  ADD COLUMN "lastErrorAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IntegrationOauthSession" (
  "id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "connectionId" TEXT NOT NULL,
  "initiatedBy" TEXT,
  "pkceVerifier" TEXT,
  "redirectUri" TEXT NOT NULL,
  "returnUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "failureReason" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IntegrationOauthSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationConnection_status_updatedAt_idx" ON "IntegrationConnection"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationOauthSession_state_key" ON "IntegrationOauthSession"("state");

-- CreateIndex
CREATE INDEX "IntegrationOauthSession_connectionId_status_idx" ON "IntegrationOauthSession"("connectionId", "status");

-- CreateIndex
CREATE INDEX "IntegrationOauthSession_orgId_provider_status_idx" ON "IntegrationOauthSession"("orgId", "provider", "status");

-- CreateIndex
CREATE INDEX "IntegrationOauthSession_status_expiresAt_idx" ON "IntegrationOauthSession"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "IntegrationOauthSession"
  ADD CONSTRAINT "IntegrationOauthSession_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
