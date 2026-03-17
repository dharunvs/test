-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('owner', 'admin', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('admin', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'blocked', 'review', 'done', 'archived');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('active', 'stale', 'merged', 'closed', 'abandoned');

-- CreateEnum
CREATE TYPE "PrStatus" AS ENUM ('open', 'draft', 'merged', 'closed');

-- CreateEnum
CREATE TYPE "QualityStatus" AS ENUM ('queued', 'running', 'passed', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "ConflictSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('extension', 'web_console', 'worker', 'webhook');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "invitedBy" TEXT,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "defaultBaseBranch" TEXT NOT NULL DEFAULT 'main',
    "settings" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRepoId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRepository" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubInstallation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "githubInstallationId" BIGINT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "installedByUserId" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubWebhookDelivery" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "deliveryId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "createdBy" TEXT NOT NULL,
    "assignedTo" TEXT,
    "externalTicketRef" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "headSha" TEXT,
    "baseSha" TEXT,
    "status" "BranchStatus" NOT NULL DEFAULT 'active',
    "isProtectedViolation" BOOLEAN NOT NULL DEFAULT false,
    "staleReason" TEXT,
    "mergedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "providerPrId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "PrStatus" NOT NULL DEFAULT 'open',
    "isDraft" BOOLEAN NOT NULL DEFAULT true,
    "mergeableState" TEXT,
    "openedBy" TEXT,
    "openedAt" TIMESTAMP(3),
    "mergedBy" TEXT,
    "mergedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntentEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "branchId" TEXT,
    "actorUserId" TEXT,
    "source" "EventSource" NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventSeq" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,
    "redactionLevel" TEXT NOT NULL DEFAULT 'none',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityPresence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceBindingId" TEXT,
    "state" TEXT NOT NULL,
    "activeFilePath" TEXT,
    "activeSymbol" TEXT,
    "updatedFromEventId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityPresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "userId" TEXT,
    "eventType" TEXT NOT NULL,
    "filePath" TEXT,
    "symbol" TEXT,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "branchId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "costUsd" DECIMAL(65,30),
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDecision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rationale" TEXT,
    "decidedBy" TEXT,
    "relatedEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "taskId" TEXT,
    "otherTaskId" TEXT,
    "severity" "ConflictSeverity" NOT NULL,
    "score" DECIMAL(65,30) NOT NULL,
    "reasonCodes" TEXT[],
    "filePaths" TEXT[],
    "symbolNames" TEXT[],
    "resolutionStatus" TEXT NOT NULL DEFAULT 'open',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnershipClaim" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeValue" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnershipClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicySet" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicySet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardrailRule" (
    "id" TEXT NOT NULL,
    "policySetId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "expression" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardrailRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardrailEvaluation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "branchId" TEXT,
    "policySetId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "violations" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardrailEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityGateRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "branchId" TEXT,
    "triggerSource" TEXT NOT NULL,
    "status" "QualityStatus" NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityGateRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityGateCheck" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "checkKey" TEXT NOT NULL,
    "status" "QualityStatus" NOT NULL,
    "durationMs" INTEGER,
    "details" JSONB NOT NULL,
    "logUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityGateCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrSlice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "sliceOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "filePaths" TEXT[],
    "riskLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrSlice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "changelog" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptUsage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "templateId" TEXT,
    "templateVersionId" TEXT,
    "aiRunId" TEXT,
    "usedBy" TEXT,
    "successRating" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoffPacket" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "branchId" TEXT,
    "generatedBy" TEXT,
    "summary" TEXT NOT NULL,
    "constraints" TEXT,
    "risks" TEXT,
    "nextSteps" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandoffPacket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoffAck" (
    "id" TEXT NOT NULL,
    "handoffPacketId" TEXT NOT NULL,
    "ackBy" TEXT NOT NULL,
    "ackAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoffAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplaySnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "artifactUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplaySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PivotEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "triggeredBy" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "baselinePayload" JSONB NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PivotEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaleContextReport" (
    "id" TEXT NOT NULL,
    "pivotEventId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaleContextReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "provider" TEXT NOT NULL,
    "externalWorkspaceId" TEXT,
    "encryptedCredentials" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionClient" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "userId" TEXT,
    "machineFingerprint" TEXT,
    "extensionVersion" TEXT NOT NULL,
    "vscodeVersion" TEXT,
    "os" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtensionClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceBinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "extensionClientId" TEXT,
    "workspaceHash" TEXT NOT NULL,
    "lastBoundAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "actorUserId" TEXT,
    "actorType" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_ownerUserId_idx" ON "Organization"("ownerUserId");

-- CreateIndex
CREATE INDEX "OrganizationMember_orgId_role_idx" ON "OrganizationMember"("orgId", "role");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_orgId_userId_key" ON "OrganizationMember"("orgId", "userId");

-- CreateIndex
CREATE INDEX "Project_orgId_createdAt_idx" ON "Project"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_orgId_key_key" ON "Project"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "Repository_orgId_provider_idx" ON "Repository"("orgId", "provider");

-- CreateIndex
CREATE INDEX "Repository_fullName_idx" ON "Repository"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_provider_providerRepoId_key" ON "Repository"("provider", "providerRepoId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRepository_projectId_repositoryId_key" ON "ProjectRepository"("projectId", "repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "GithubInstallation_githubInstallationId_key" ON "GithubInstallation"("githubInstallationId");

-- CreateIndex
CREATE INDEX "GithubInstallation_orgId_idx" ON "GithubInstallation"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "GithubWebhookDelivery_deliveryId_key" ON "GithubWebhookDelivery"("deliveryId");

-- CreateIndex
CREATE INDEX "GithubWebhookDelivery_orgId_idx" ON "GithubWebhookDelivery"("orgId");

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- CreateIndex
CREATE INDEX "Task_assignedTo_status_idx" ON "Task"("assignedTo", "status");

-- CreateIndex
CREATE INDEX "Task_repositoryId_createdAt_idx" ON "Task"("repositoryId", "createdAt");

-- CreateIndex
CREATE INDEX "Branch_taskId_idx" ON "Branch"("taskId");

-- CreateIndex
CREATE INDEX "Branch_projectId_status_idx" ON "Branch"("projectId", "status");

-- CreateIndex
CREATE INDEX "Branch_repositoryId_status_idx" ON "Branch"("repositoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_repositoryId_name_key" ON "Branch"("repositoryId", "name");

-- CreateIndex
CREATE INDEX "PullRequest_branchId_idx" ON "PullRequest"("branchId");

-- CreateIndex
CREATE INDEX "PullRequest_status_createdAt_idx" ON "PullRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_repositoryId_number_key" ON "PullRequest"("repositoryId", "number");

-- CreateIndex
CREATE INDEX "IntentEvent_taskId_occurredAt_idx" ON "IntentEvent"("taskId", "occurredAt");

-- CreateIndex
CREATE INDEX "IntentEvent_projectId_occurredAt_idx" ON "IntentEvent"("projectId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntentEvent_taskId_eventSeq_key" ON "IntentEvent"("taskId", "eventSeq");

-- CreateIndex
CREATE INDEX "ActivityPresence_projectId_lastSeenAt_idx" ON "ActivityPresence"("projectId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityPresence_projectId_userId_key" ON "ActivityPresence"("projectId", "userId");

-- CreateIndex
CREATE INDEX "ActivityEvent_projectId_occurredAt_idx" ON "ActivityEvent"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_filePath_occurredAt_idx" ON "ActivityEvent"("filePath", "occurredAt");

-- CreateIndex
CREATE INDEX "AiRun_taskId_startedAt_idx" ON "AiRun"("taskId", "startedAt");

-- CreateIndex
CREATE INDEX "AiRun_projectId_provider_model_idx" ON "AiRun"("projectId", "provider", "model");

-- CreateIndex
CREATE INDEX "TaskDecision_taskId_createdAt_idx" ON "TaskDecision"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "ConflictEvent_projectId_resolutionStatus_severity_idx" ON "ConflictEvent"("projectId", "resolutionStatus", "severity");

-- CreateIndex
CREATE INDEX "OwnershipClaim_projectId_scopeType_scopeValue_idx" ON "OwnershipClaim"("projectId", "scopeType", "scopeValue");

-- CreateIndex
CREATE INDEX "OwnershipClaim_expiresAt_idx" ON "OwnershipClaim"("expiresAt");

-- CreateIndex
CREATE INDEX "PolicySet_projectId_status_idx" ON "PolicySet"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PolicySet_projectId_name_version_key" ON "PolicySet"("projectId", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "GuardrailRule_policySetId_ruleKey_key" ON "GuardrailRule"("policySetId", "ruleKey");

-- CreateIndex
CREATE INDEX "GuardrailEvaluation_taskId_evaluatedAt_idx" ON "GuardrailEvaluation"("taskId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "GuardrailEvaluation_projectId_status_idx" ON "GuardrailEvaluation"("projectId", "status");

-- CreateIndex
CREATE INDEX "QualityGateRun_taskId_createdAt_idx" ON "QualityGateRun"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "QualityGateRun_projectId_status_idx" ON "QualityGateRun"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QualityGateCheck_runId_checkKey_key" ON "QualityGateCheck"("runId", "checkKey");

-- CreateIndex
CREATE INDEX "PrSlice_pullRequestId_sliceOrder_idx" ON "PrSlice"("pullRequestId", "sliceOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PrSlice_pullRequestId_sliceOrder_key" ON "PrSlice"("pullRequestId", "sliceOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_orgId_projectId_slug_key" ON "PromptTemplate"("orgId", "projectId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplateVersion_templateId_version_key" ON "PromptTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "PromptUsage_templateId_createdAt_idx" ON "PromptUsage"("templateId", "createdAt");

-- CreateIndex
CREATE INDEX "PromptUsage_projectId_createdAt_idx" ON "PromptUsage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "HandoffPacket_taskId_createdAt_idx" ON "HandoffPacket"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HandoffAck_handoffPacketId_ackBy_key" ON "HandoffAck"("handoffPacketId", "ackBy");

-- CreateIndex
CREATE INDEX "ReplaySnapshot_taskId_snapshotVersion_idx" ON "ReplaySnapshot"("taskId", "snapshotVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ReplaySnapshot_taskId_snapshotVersion_key" ON "ReplaySnapshot"("taskId", "snapshotVersion");

-- CreateIndex
CREATE INDEX "PivotEvent_projectId_effectiveAt_idx" ON "PivotEvent"("projectId", "effectiveAt");

-- CreateIndex
CREATE INDEX "StaleContextReport_pivotEventId_status_idx" ON "StaleContextReport"("pivotEventId", "status");

-- CreateIndex
CREATE INDEX "IntegrationConnection_orgId_provider_status_idx" ON "IntegrationConnection"("orgId", "provider", "status");

-- CreateIndex
CREATE INDEX "IntegrationLink_entityType_entityId_idx" ON "IntegrationLink"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "IntegrationLink_provider_externalRef_idx" ON "IntegrationLink"("provider", "externalRef");

-- CreateIndex
CREATE INDEX "Notification_userId_status_createdAt_idx" ON "Notification"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExtensionClient_userId_lastSeenAt_idx" ON "ExtensionClient"("userId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "WorkspaceBinding_projectId_userId_idx" ON "WorkspaceBinding"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceBinding_userId_workspaceHash_key" ON "WorkspaceBinding"("userId", "workspaceHash");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_occurredAt_idx" ON "AuditLog"("orgId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_occurredAt_idx" ON "AuditLog"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_eventType_occurredAt_idx" ON "AuditLog"("eventType", "occurredAt");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRepository" ADD CONSTRAINT "ProjectRepository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRepository" ADD CONSTRAINT "ProjectRepository_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubInstallation" ADD CONSTRAINT "GithubInstallation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntentEvent" ADD CONSTRAINT "IntentEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntentEvent" ADD CONSTRAINT "IntentEvent_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDecision" ADD CONSTRAINT "TaskDecision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictEvent" ADD CONSTRAINT "ConflictEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictEvent" ADD CONSTRAINT "ConflictEvent_otherTaskId_fkey" FOREIGN KEY ("otherTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipClaim" ADD CONSTRAINT "OwnershipClaim_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySet" ADD CONSTRAINT "PolicySet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardrailRule" ADD CONSTRAINT "GuardrailRule_policySetId_fkey" FOREIGN KEY ("policySetId") REFERENCES "PolicySet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardrailEvaluation" ADD CONSTRAINT "GuardrailEvaluation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardrailEvaluation" ADD CONSTRAINT "GuardrailEvaluation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardrailEvaluation" ADD CONSTRAINT "GuardrailEvaluation_policySetId_fkey" FOREIGN KEY ("policySetId") REFERENCES "PolicySet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityGateRun" ADD CONSTRAINT "QualityGateRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityGateRun" ADD CONSTRAINT "QualityGateRun_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityGateCheck" ADD CONSTRAINT "QualityGateCheck_runId_fkey" FOREIGN KEY ("runId") REFERENCES "QualityGateRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrSlice" ADD CONSTRAINT "PrSlice_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrSlice" ADD CONSTRAINT "PrSlice_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplateVersion" ADD CONSTRAINT "PromptTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PromptTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptUsage" ADD CONSTRAINT "PromptUsage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptUsage" ADD CONSTRAINT "PromptUsage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PromptTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptUsage" ADD CONSTRAINT "PromptUsage_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "PromptTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptUsage" ADD CONSTRAINT "PromptUsage_aiRunId_fkey" FOREIGN KEY ("aiRunId") REFERENCES "AiRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffPacket" ADD CONSTRAINT "HandoffPacket_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffPacket" ADD CONSTRAINT "HandoffPacket_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffAck" ADD CONSTRAINT "HandoffAck_handoffPacketId_fkey" FOREIGN KEY ("handoffPacketId") REFERENCES "HandoffPacket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplaySnapshot" ADD CONSTRAINT "ReplaySnapshot_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PivotEvent" ADD CONSTRAINT "PivotEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaleContextReport" ADD CONSTRAINT "StaleContextReport_pivotEventId_fkey" FOREIGN KEY ("pivotEventId") REFERENCES "PivotEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceBinding" ADD CONSTRAINT "WorkspaceBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceBinding" ADD CONSTRAINT "WorkspaceBinding_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceBinding" ADD CONSTRAINT "WorkspaceBinding_extensionClientId_fkey" FOREIGN KEY ("extensionClientId") REFERENCES "ExtensionClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

