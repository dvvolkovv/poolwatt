-- CreateEnum
CREATE TYPE "PromoGrantKind" AS ENUM ('ENERGY', 'FREE_BOOKING');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CampaignTrigger" ADD VALUE 'PROMO_CODE';
ALTER TYPE "CampaignTrigger" ADD VALUE 'BIRTHDAY';

-- DropIndex
DROP INDEX "PromoGrant_campaignId_paymentId_key";

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "budgetGrants" INTEGER,
ADD COLUMN     "discountPct" DECIMAL(5,2),
ADD COLUMN     "exclusive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "freeBooking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "issuedGrants" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promoCode" TEXT;

-- AlterTable
ALTER TABLE "PromoGrant" ADD COLUMN     "discountPct" DECIMAL(5,2),
ADD COLUMN     "kind" "PromoGrantKind" NOT NULL DEFAULT 'ENERGY',
ADD COLUMN     "usedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "promoGrantId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "birthDay" INTEGER,
ADD COLUMN     "birthMonth" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_operatorId_promoCode_key" ON "Campaign"("operatorId", "promoCode");

-- CreateIndex
CREATE UNIQUE INDEX "PromoGrant_campaignId_paymentId_kind_key" ON "PromoGrant"("campaignId", "paymentId", "kind");

