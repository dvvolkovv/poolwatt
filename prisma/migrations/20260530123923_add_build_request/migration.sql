-- CreateEnum
CREATE TYPE "BuildRequestSource" AS ENUM ('SOLAR', 'WIND', 'HYBRID');

-- CreateEnum
CREATE TYPE "BuildRequestSiteType" AS ENUM ('PRIVATE_HOUSE', 'APARTMENT_ROOF', 'LAND_PLOT', 'COMMERCIAL');

-- CreateEnum
CREATE TYPE "BuildRequestRoofOrientation" AS ENUM ('S', 'SE', 'SW', 'E', 'W', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BuildRequestBudget" AS ENUM ('UNDER_5K', 'FROM_5K_TO_15K', 'FROM_15K_TO_30K', 'FROM_30K_TO_60K', 'OVER_60K', 'AWAITING_QUOTE');

-- CreateEnum
CREATE TYPE "BuildRequestTimeline" AS ENUM ('URGENT_1_3M', 'WITHIN_YEAR', 'EXPLORING');

-- CreateEnum
CREATE TYPE "BuildRequestStatus" AS ENUM ('OPEN', 'MATCHED', 'FULFILLED', 'CANCELLED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "BuildRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "BuildRequestSource" NOT NULL,
    "peakKw" DECIMAL(8,2) NOT NULL,
    "wantPowerbank" BOOLEAN NOT NULL DEFAULT false,
    "powerbankKwh" DECIMAL(8,2),
    "wantEvCharger" BOOLEAN NOT NULL DEFAULT false,
    "evChargerPorts" INTEGER,
    "evPublicForSale" BOOLEAN NOT NULL DEFAULT false,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "siteType" "BuildRequestSiteType" NOT NULL,
    "availableAreaM2" INTEGER,
    "roofOrientation" "BuildRequestRoofOrientation",
    "budget" "BuildRequestBudget" NOT NULL DEFAULT 'AWAITING_QUOTE',
    "timeline" "BuildRequestTimeline" NOT NULL DEFAULT 'EXPLORING',
    "notes" TEXT,
    "status" "BuildRequestStatus" NOT NULL DEFAULT 'OPEN',
    "adminNote" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuildRequest_userId_createdAt_idx" ON "BuildRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BuildRequest_status_createdAt_idx" ON "BuildRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BuildRequest_country_status_idx" ON "BuildRequest"("country", "status");

-- AddForeignKey
ALTER TABLE "BuildRequest" ADD CONSTRAINT "BuildRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildRequest" ADD CONSTRAINT "BuildRequest_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
