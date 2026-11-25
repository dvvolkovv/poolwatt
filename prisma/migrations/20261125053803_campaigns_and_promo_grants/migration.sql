-- CreateEnum
CREATE TYPE "CampaignTrigger" AS ENUM ('FIRST_CHARGE', 'NTH_CHARGE', 'VOLUME_PERIOD');

-- CreateEnum
CREATE TYPE "CampaignFunding" AS ENUM ('TOKENS', 'FIAT');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'EXHAUSTED', 'ENDED');

-- CreateEnum
CREATE TYPE "PromoGrantStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "CampaignTrigger" NOT NULL,
    "triggerN" INTEGER,
    "triggerPeriodDays" INTEGER,
    "giftKwh" DECIMAL(18,3) NOT NULL,
    "scopePointIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validityDays" INTEGER NOT NULL,
    "oncePerClient" BOOLEAN NOT NULL DEFAULT true,
    "minNextChargeKwh" DECIMAL(18,3),
    "budgetKwh" DECIMAL(18,3) NOT NULL,
    "issuedKwh" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "fundingSource" "CampaignFunding" NOT NULL DEFAULT 'TOKENS',
    "zoneId" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "pauseReason" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoGrant" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "amountKwh" DECIMAL(18,3) NOT NULL,
    "usedKwh" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "PromoGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "PromoGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_operatorId_status_idx" ON "Campaign"("operatorId", "status");

-- CreateIndex
CREATE INDEX "Campaign_status_startsAt_endsAt_idx" ON "Campaign"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "PromoGrant_userId_status_expiresAt_idx" ON "PromoGrant"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "PromoGrant_status_expiresAt_idx" ON "PromoGrant"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromoGrant_campaignId_userId_key" ON "PromoGrant"("campaignId", "userId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "GridZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoGrant" ADD CONSTRAINT "PromoGrant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoGrant" ADD CONSTRAINT "PromoGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoGrant" ADD CONSTRAINT "PromoGrant_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
