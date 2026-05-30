-- CreateEnum
CREATE TYPE "EvPowerSource" AS ENUM ('GRID', 'MIXED', 'RENEWABLE_ONLY');

-- CreateEnum
CREATE TYPE "EvConnectorType" AS ENUM ('CCS2', 'CHAdeMO', 'TYPE2', 'TYPE1', 'TESLA', 'GB_T', 'SCHUKO');

-- CreateEnum
CREATE TYPE "EvPowerLevel" AS ENUM ('AC_SLOW', 'AC_FAST', 'DC_FAST', 'DC_ULTRA');

-- CreateEnum
CREATE TYPE "EvUsageType" AS ENUM ('PUBLIC', 'MEMBERSHIP', 'PRIVATE', 'PAY_AT_LOCATION');

-- AlterTable
ALTER TABLE "Contractor" ADD COLUMN     "evConnectorTypes" "EvConnectorType"[],
ADD COLUMN     "evDescription" TEXT,
ADD COLUMN     "evMaxPowerKw" DECIMAL(6,2),
ADD COLUMN     "evPowerLevels" "EvPowerLevel"[],
ADD COLUMN     "evPowerSource" "EvPowerSource",
ADD COLUMN     "evStationCount" INTEGER,
ADD COLUMN     "evUsageType" "EvUsageType",
ADD COLUMN     "providesEvCharging" BOOLEAN NOT NULL DEFAULT false;
