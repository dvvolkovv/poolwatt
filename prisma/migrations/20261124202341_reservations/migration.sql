-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('CREATED', 'ACTIVE', 'FULFILLED', 'CANCELLED', 'NO_SHOW', 'EXPIRED');

-- AlterEnum
ALTER TYPE "ConnectorStatus" ADD VALUE 'BOOKED';

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "reservationId" TEXT;

-- CreateTable
CREATE TABLE "ReservationPolicy" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "bookableConnectorIds" TEXT[],
    "walkUpConnectors" INTEGER NOT NULL DEFAULT 1,
    "feeFiat" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "feeTokens" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "feeCountsTowards" BOOLEAN NOT NULL DEFAULT true,
    "guaranteeFiat" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "noShowPenaltyFiat" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "waitMinutes" INTEGER NOT NULL DEFAULT 15,
    "freeCancelMinutes" INTEGER NOT NULL DEFAULT 30,
    "maxAheadHours" INTEGER NOT NULL DEFAULT 24,
    "extendAllowed" BOOLEAN NOT NULL DEFAULT true,
    "extendFeeFiat" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "coopFree" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "eta" TIMESTAMP(3) NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "feeFiat" DECIMAL(10,2) NOT NULL,
    "guaranteeFiat" DECIMAL(10,2) NOT NULL,
    "noShowPenaltyFiat" DECIMAL(10,2) NOT NULL,
    "freeCancelMinutes" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "ReservationStatus" NOT NULL DEFAULT 'CREATED',
    "penaltyFiat" DECIMAL(10,2),
    "refundFiat" DECIMAL(10,2),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReservationPolicy_pointId_key" ON "ReservationPolicy"("pointId");

-- CreateIndex
CREATE INDEX "Reservation_userId_status_idx" ON "Reservation"("userId", "status");

-- CreateIndex
CREATE INDEX "Reservation_connectorId_status_idx" ON "Reservation"("connectorId", "status");

-- CreateIndex
CREATE INDEX "Reservation_status_windowEnd_idx" ON "Reservation"("status", "windowEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_reservationId_key" ON "Receipt"("reservationId");

-- AddForeignKey
ALTER TABLE "ReservationPolicy" ADD CONSTRAINT "ReservationPolicy_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "AcceptancePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "AcceptancePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "PointConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

