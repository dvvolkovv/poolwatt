-- US-12: cashback as a campaign rule, and a grant that may repeat.

-- AlterEnum
ALTER TYPE "CampaignTrigger" ADD VALUE 'TOKEN_PAYMENT';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "cashbackPct" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "PromoGrant" ADD COLUMN     "onceKey" TEXT,
ADD COLUMN     "paymentId" TEXT;

-- §42 "Один раз на клиента" moves from the blanket unique into `onceKey`:
-- every grant that exists today belongs to a campaign that gave once, so it
-- keeps the rule.
UPDATE "PromoGrant" g
SET "onceKey" = 'once'
FROM "Campaign" c
WHERE c.id = g."campaignId" AND c."oncePerClient" = true;

-- DropIndex
DROP INDEX "PromoGrant_campaignId_userId_key";

-- CreateIndex
CREATE UNIQUE INDEX "PromoGrant_campaignId_userId_onceKey_key" ON "PromoGrant"("campaignId", "userId", "onceKey");

-- CreateIndex
CREATE UNIQUE INDEX "PromoGrant_campaignId_paymentId_key" ON "PromoGrant"("campaignId", "paymentId");

-- AddForeignKey
ALTER TABLE "PromoGrant" ADD CONSTRAINT "PromoGrant_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
