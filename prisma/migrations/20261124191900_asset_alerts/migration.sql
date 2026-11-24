-- CreateEnum
CREATE TYPE "AssetAlertKind" AS ENUM ('TELEMETRY_ANOMALY', 'LINK_LOST', 'SUSPENDED');

-- CreateTable
CREATE TABLE "AssetAlert" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" "AssetAlertKind" NOT NULL,
    "note" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "AssetAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetAlert_assetId_resolvedAt_idx" ON "AssetAlert"("assetId", "resolvedAt");

-- CreateIndex
CREATE INDEX "AssetAlert_resolvedAt_notifiedAt_idx" ON "AssetAlert"("resolvedAt", "notifiedAt");

-- AddForeignKey
ALTER TABLE "AssetAlert" ADD CONSTRAINT "AssetAlert_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
