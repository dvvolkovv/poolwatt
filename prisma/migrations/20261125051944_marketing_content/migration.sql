-- CreateEnum
CREATE TYPE "MarketingContentType" AS ENUM ('BANNER', 'VIDEO', 'GALLERY', 'PROMO', 'NEWS', 'LINK');

-- CreateEnum
CREATE TYPE "MarketingAudience" AS ENUM ('ALL', 'NEWCOMERS', 'REGULARS', 'COOP_MEMBERS', 'CARD_HOLDERS');

-- CreateEnum
CREATE TYPE "MarketingStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "MarketingContent" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "pointIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "type" "MarketingContentType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "linkUrl" TEXT,
    "placements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audience" "MarketingAudience" NOT NULL DEFAULT 'ALL',
    "zoneId" TEXT,
    "radiusKm" INTEGER,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "hourFrom" INTEGER,
    "hourTo" INTEGER,
    "status" "MarketingStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAsset" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingContent_operatorId_status_idx" ON "MarketingContent"("operatorId", "status");

-- CreateIndex
CREATE INDEX "MarketingContent_status_startsAt_endsAt_idx" ON "MarketingContent"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAsset_storageKey_key" ON "MarketingAsset"("storageKey");

-- CreateIndex
CREATE INDEX "MarketingAsset_contentId_position_idx" ON "MarketingAsset"("contentId", "position");

-- AddForeignKey
ALTER TABLE "MarketingContent" ADD CONSTRAINT "MarketingContent_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContent" ADD CONSTRAINT "MarketingContent_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "GridZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAsset" ADD CONSTRAINT "MarketingAsset_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "MarketingContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
