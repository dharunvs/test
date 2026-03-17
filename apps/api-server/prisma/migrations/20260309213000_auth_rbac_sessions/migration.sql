-- AlterTable
ALTER TABLE "OrganizationMember"
  ADD COLUMN "inviteExpiresAt" TIMESTAMP(3),
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectMember"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "DeviceAuthSession" (
  "id" TEXT NOT NULL,
  "deviceCode" TEXT NOT NULL,
  "userCode" TEXT NOT NULL,
  "userId" TEXT,
  "email" TEXT NOT NULL,
  "role" "OrgRole" NOT NULL,
  "clerkUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "exchangedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DeviceAuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "replacedByTokenId" TEXT,
  "userAgent" TEXT,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuthSession_deviceCode_key" ON "DeviceAuthSession"("deviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuthSession_userCode_key" ON "DeviceAuthSession"("userCode");

-- CreateIndex
CREATE INDEX "DeviceAuthSession_status_expiresAt_idx" ON "DeviceAuthSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "DeviceAuthSession_email_idx" ON "DeviceAuthSession"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_expiresAt_idx" ON "RefreshToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "RefreshToken_revokedAt_idx" ON "RefreshToken"("revokedAt");

-- AddForeignKey
ALTER TABLE "DeviceAuthSession" ADD CONSTRAINT "DeviceAuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_replacedByTokenId_fkey" FOREIGN KEY ("replacedByTokenId") REFERENCES "RefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
