-- CreateEnum
CREATE TYPE "PointType" AS ENUM ('CHARGING_STATION', 'POWERBANK', 'GENERATION', 'MIXED');

-- CreateEnum
CREATE TYPE "PointStatus" AS ENUM ('DRAFT', 'REVIEW', 'TEST', 'PUBLISHED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PointEnergySource" AS ENUM ('SOLAR', 'WIND', 'BIOGAS', 'HYDRO', 'GRID', 'MIXED');

-- CreateEnum
CREATE TYPE "PointVisibility" AS ENUM ('PUBLIC', 'COOP_MEMBERS', 'OWN_CLIENTS');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('FREE', 'BUSY', 'OUT_OF_SERVICE', 'UNKNOWN');

-- CreateTable
CREATE TABLE "AcceptancePoint" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "type" "PointType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PointStatus" NOT NULL DEFAULT 'DRAFT',
    "country" TEXT,
    "city" TEXT,
    "addressLine" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gridZoneId" TEXT,
    "howToFind" TEXT,
    "energySource" "PointEnergySource",
    "goCertificateRef" TEXT,
    "storageKwh" DECIMAL(12,3),
    "open24" BOOLEAN NOT NULL DEFAULT false,
    "openHours" JSONB,
    "holidayNote" TEXT,
    "closedFrom" TIMESTAMP(3),
    "closedUntil" TIMESTAMP(3),
    "paymentMethods" TEXT[],
    "amenities" TEXT[],
    "ocppVersion" TEXT,
    "meterId" TEXT,
    "visibility" "PointVisibility" NOT NULL DEFAULT 'PUBLIC',
    "logoUrl" TEXT,
    "pinColor" TEXT,
    "description" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "publishedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcceptancePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointConnector" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "type" "EvConnectorType" NOT NULL,
    "powerKw" DECIMAL(8,2) NOT NULL,
    "currentAc" BOOLEAN NOT NULL DEFAULT true,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'UNKNOWN',
    "statusAt" TIMESTAMP(3),

    CONSTRAINT "PointConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTariff" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "label" TEXT,
    "fromMinute" INTEGER NOT NULL DEFAULT 0,
    "toMinute" INTEGER NOT NULL DEFAULT 1440,
    "priceFiat" DECIMAL(10,4),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "priceTokens" DECIMAL(10,4),
    "idleFeePerMin" DECIMAL(10,4),
    "coopDiscount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PointTariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointPhoto" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointApiKey" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "label" TEXT,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "signingSecretEnc" TEXT,
    "signingSecretIv" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PointApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcceptancePoint_operatorId_status_idx" ON "AcceptancePoint"("operatorId", "status");

-- CreateIndex
CREATE INDEX "AcceptancePoint_status_latitude_longitude_idx" ON "AcceptancePoint"("status", "latitude", "longitude");

-- CreateIndex
CREATE INDEX "PointConnector_pointId_idx" ON "PointConnector"("pointId");

-- CreateIndex
CREATE INDEX "PointConnector_type_status_idx" ON "PointConnector"("type", "status");

-- CreateIndex
CREATE INDEX "PointTariff_pointId_idx" ON "PointTariff"("pointId");

-- CreateIndex
CREATE UNIQUE INDEX "PointPhoto_storageKey_key" ON "PointPhoto"("storageKey");

-- CreateIndex
CREATE INDEX "PointPhoto_pointId_position_idx" ON "PointPhoto"("pointId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PointApiKey_tokenHash_key" ON "PointApiKey"("tokenHash");

-- CreateIndex
CREATE INDEX "PointApiKey_pointId_idx" ON "PointApiKey"("pointId");

-- AddForeignKey
ALTER TABLE "AcceptancePoint" ADD CONSTRAINT "AcceptancePoint_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptancePoint" ADD CONSTRAINT "AcceptancePoint_gridZoneId_fkey" FOREIGN KEY ("gridZoneId") REFERENCES "GridZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointConnector" ADD CONSTRAINT "PointConnector_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "AcceptancePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTariff" ADD CONSTRAINT "PointTariff_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "AcceptancePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointPhoto" ADD CONSTRAINT "PointPhoto_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "AcceptancePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointApiKey" ADD CONSTRAINT "PointApiKey_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "AcceptancePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
