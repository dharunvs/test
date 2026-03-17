-- CreateEnum
CREATE TYPE "KnowledgeDocType" AS ENUM ('brief', 'module_diagram', 'flow_diagram', 'architecture_notes', 'decision_log');

-- CreateEnum
CREATE TYPE "KnowledgeDocStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "KnowledgeApprovalStatus" AS ENUM ('draft', 'approved', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "KnowledgeProposedByType" AS ENUM ('user', 'llm', 'system');

-- CreateEnum
CREATE TYPE "ProjectPhaseStatus" AS ENUM ('planned', 'in_progress', 'blocked', 'completed', 'archived');

-- CreateTable
CREATE TABLE "ProjectKnowledgeDoc" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "type" "KnowledgeDocType" NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "KnowledgeDocStatus" NOT NULL DEFAULT 'active',
  "activeVersion" INTEGER,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectKnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectKnowledgeVersion" (
  "id" TEXT NOT NULL,
  "docId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "contentMarkdown" TEXT,
  "mermaidSource" TEXT,
  "changeSummary" TEXT,
  "approvalStatus" "KnowledgeApprovalStatus" NOT NULL DEFAULT 'draft',
  "proposedBy" TEXT,
  "proposedByType" "KnowledgeProposedByType" NOT NULL DEFAULT 'user',
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "sourceTaskId" TEXT,
  "sourceAiRunId" TEXT,
  "baseVersion" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectKnowledgeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPhase" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "objective" TEXT,
  "status" "ProjectPhaseStatus" NOT NULL DEFAULT 'planned',
  "ownerUserId" TEXT,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "plannedStartAt" TIMESTAMP(3),
  "plannedEndAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPhaseRevision" (
  "id" TEXT NOT NULL,
  "phaseId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "approvalStatus" "KnowledgeApprovalStatus" NOT NULL DEFAULT 'draft',
  "proposedBy" TEXT,
  "proposedByType" "KnowledgeProposedByType" NOT NULL DEFAULT 'user',
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "sourceTaskId" TEXT,
  "sourceAiRunId" TEXT,
  "baseRevision" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectPhaseRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectKnowledgeDoc_projectId_slug_key" ON "ProjectKnowledgeDoc"("projectId", "slug");

-- CreateIndex
CREATE INDEX "ProjectKnowledgeDoc_projectId_type_updatedAt_idx" ON "ProjectKnowledgeDoc"("projectId", "type", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectKnowledgeVersion_docId_version_key" ON "ProjectKnowledgeVersion"("docId", "version");

-- CreateIndex
CREATE INDEX "ProjectKnowledgeVersion_docId_approvalStatus_createdAt_idx" ON "ProjectKnowledgeVersion"("docId", "approvalStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPhase_projectId_key_key" ON "ProjectPhase"("projectId", "key");

-- CreateIndex
CREATE INDEX "ProjectPhase_projectId_orderIndex_status_idx" ON "ProjectPhase"("projectId", "orderIndex", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPhaseRevision_phaseId_revision_key" ON "ProjectPhaseRevision"("phaseId", "revision");

-- CreateIndex
CREATE INDEX "ProjectPhaseRevision_phaseId_approvalStatus_createdAt_idx" ON "ProjectPhaseRevision"("phaseId", "approvalStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectKnowledgeDoc"
  ADD CONSTRAINT "ProjectKnowledgeDoc_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectKnowledgeVersion"
  ADD CONSTRAINT "ProjectKnowledgeVersion_docId_fkey"
  FOREIGN KEY ("docId") REFERENCES "ProjectKnowledgeDoc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhase"
  ADD CONSTRAINT "ProjectPhase_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhaseRevision"
  ADD CONSTRAINT "ProjectPhaseRevision_phaseId_fkey"
  FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill brief docs from Project.description for compatibility
WITH source_projects AS (
  SELECT
    p."id" AS "projectId",
    p."orgId" AS "orgId",
    p."description" AS "description",
    p."createdBy" AS "createdBy",
    p."createdAt" AS "createdAt",
    p."updatedAt" AS "updatedAt"
  FROM "Project" p
  WHERE p."description" IS NOT NULL
    AND LENGTH(TRIM(p."description")) > 0
), inserted_docs AS (
  INSERT INTO "ProjectKnowledgeDoc" (
    "id",
    "orgId",
    "projectId",
    "type",
    "slug",
    "title",
    "status",
    "activeVersion",
    "createdBy",
    "createdAt",
    "updatedAt"
  )
  SELECT
    CONCAT('pkd_', MD5(sp."projectId" || ':' || clock_timestamp()::text || ':' || random()::text)),
    sp."orgId",
    sp."projectId",
    'brief'::"KnowledgeDocType",
    'project-brief',
    'Project Brief',
    'active'::"KnowledgeDocStatus",
    1,
    sp."createdBy",
    sp."createdAt",
    sp."updatedAt"
  FROM source_projects sp
  RETURNING "id", "projectId"
)
INSERT INTO "ProjectKnowledgeVersion" (
  "id",
  "docId",
  "version",
  "contentMarkdown",
  "mermaidSource",
  "changeSummary",
  "approvalStatus",
  "proposedBy",
  "proposedByType",
  "approvedBy",
  "approvedAt",
  "sourceTaskId",
  "sourceAiRunId",
  "baseVersion",
  "createdAt"
)
SELECT
  CONCAT('pkv_', MD5(idoc."id" || ':' || clock_timestamp()::text || ':' || random()::text)),
  idoc."id",
  1,
  p."description",
  NULL,
  'Backfilled from projects.description',
  'approved'::"KnowledgeApprovalStatus",
  p."createdBy",
  'system'::"KnowledgeProposedByType",
  p."createdBy",
  p."updatedAt",
  NULL,
  NULL,
  1,
  p."updatedAt"
FROM inserted_docs idoc
JOIN "Project" p ON p."id" = idoc."projectId";
