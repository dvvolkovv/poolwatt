-- AlterTable
ALTER TABLE "GridZone" ADD COLUMN     "spotAreaCode" TEXT;

-- CreateTable
CREATE TABLE "ZoneSpotPrice" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "intervalStart" TIMESTAMP(3) NOT NULL,
    "price" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZoneSpotPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZoneSpotPrice_zoneId_intervalStart_idx" ON "ZoneSpotPrice"("zoneId", "intervalStart");

-- CreateIndex
CREATE UNIQUE INDEX "ZoneSpotPrice_zoneId_intervalStart_source_key" ON "ZoneSpotPrice"("zoneId", "intervalStart", "source");

-- AddForeignKey
ALTER TABLE "ZoneSpotPrice" ADD CONSTRAINT "ZoneSpotPrice_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "GridZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

