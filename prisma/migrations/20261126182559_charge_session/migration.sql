-- CreateEnum
CREATE TYPE "ChargeSessionStatus" AS ENUM ('AUTHORIZED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "ChargeSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "reservationId" TEXT,
    "status" "ChargeSessionStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "plannedKwh" DECIMAL(18,3) NOT NULL,
    "deliveredKwh" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "authorizedFiat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "quote" JSONB NOT NULL DEFAULT '{}',
    "tariffVersion" INTEGER,
    "paymentId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "lastMeterAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "closeReason" TEXT,

    CONSTRAINT "ChargeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeSessionTick" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kwhTotal" DECIMAL(18,3) NOT NULL,
    "powerKw" DECIMAL(8,2),

    CONSTRAINT "ChargeSessionTick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChargeSession_reservationId_key" ON "ChargeSession"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeSession_paymentId_key" ON "ChargeSession"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeSession_idempotencyKey_key" ON "ChargeSession"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ChargeSession_userId_status_idx" ON "ChargeSession"("userId", "status");

-- CreateIndex
CREATE INDEX "ChargeSession_connectorId_status_idx" ON "ChargeSession"("connectorId", "status");

-- CreateIndex
CREATE INDEX "ChargeSession_status_lastMeterAt_idx" ON "ChargeSession"("status", "lastMeterAt");

-- CreateIndex
CREATE INDEX "ChargeSessionTick_sessionId_at_idx" ON "ChargeSessionTick"("sessionId", "at");

-- AddForeignKey
ALTER TABLE "ChargeSession" ADD CONSTRAINT "ChargeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeSession" ADD CONSTRAINT "ChargeSession_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeSession" ADD CONSTRAINT "ChargeSession_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "GridZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeSession" ADD CONSTRAINT "ChargeSession_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "AcceptancePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeSession" ADD CONSTRAINT "ChargeSession_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "PointConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeSession" ADD CONSTRAINT "ChargeSession_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeSession" ADD CONSTRAINT "ChargeSession_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeSessionTick" ADD CONSTRAINT "ChargeSessionTick_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChargeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
