ALTER TABLE "Notification"
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "lastStatusCode" INTEGER,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Notification_orgId_status_updatedAt_idx"
  ON "Notification"("orgId", "status", "updatedAt");
