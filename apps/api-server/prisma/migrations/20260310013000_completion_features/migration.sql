-- AlterTable
ALTER TABLE "IntegrationConnection"
  ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastRotatedAt" TIMESTAMP(3),
  ADD COLUMN "lastHealthStatus" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "lastHealthCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IntegrationCredentialRotation" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "rotatedBy" TEXT,
  "previousFingerprint" TEXT,
  "nextFingerprint" TEXT,
  "reason" TEXT,
  "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IntegrationCredentialRotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityArtifact" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "checkId" TEXT,
  "artifactType" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "contentType" TEXT,
  "sizeBytes" INTEGER,
  "retentionClass" TEXT NOT NULL DEFAULT 'standard',
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QualityArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedactionPolicy" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "capturePromptText" BOOLEAN NOT NULL DEFAULT true,
  "captureCodeSnippets" BOOLEAN NOT NULL DEFAULT true,
  "redactionPatterns" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RedactionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "intentEventsDays" INTEGER NOT NULL DEFAULT 90,
  "activityEventsDays" INTEGER NOT NULL DEFAULT 30,
  "qualityArtifactsDays" INTEGER NOT NULL DEFAULT 30,
  "auditLogsDays" INTEGER NOT NULL DEFAULT 365,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationCredentialRotation_connectionId_rotatedAt_idx" ON "IntegrationCredentialRotation"("connectionId", "rotatedAt");

-- CreateIndex
CREATE INDEX "QualityArtifact_runId_createdAt_idx" ON "QualityArtifact"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "QualityArtifact_checkId_idx" ON "QualityArtifact"("checkId");

-- CreateIndex
CREATE INDEX "RedactionPolicy_orgId_status_updatedAt_idx" ON "RedactionPolicy"("orgId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "RetentionPolicy_orgId_projectId_status_updatedAt_idx" ON "RetentionPolicy"("orgId", "projectId", "status", "updatedAt");

-- AddForeignKey
ALTER TABLE "IntegrationCredentialRotation"
  ADD CONSTRAINT "IntegrationCredentialRotation_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityArtifact"
  ADD CONSTRAINT "QualityArtifact_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "QualityGateRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityArtifact"
  ADD CONSTRAINT "QualityArtifact_checkId_fkey"
  FOREIGN KEY ("checkId") REFERENCES "QualityGateCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
