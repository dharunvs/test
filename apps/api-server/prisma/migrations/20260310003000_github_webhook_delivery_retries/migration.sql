-- AlterTable
ALTER TABLE "GithubWebhookDelivery"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'queued',
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextRetryAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "GithubWebhookDelivery_status_nextRetryAt_idx"
  ON "GithubWebhookDelivery"("status", "nextRetryAt");
