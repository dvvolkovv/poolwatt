-- CreateEnum
CREATE TYPE "RoamingSettlementStatus" AS ENUM ('OPEN', 'NETTED');

-- CreateTable
CREATE TABLE "RoamingSettlement" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT,
    "deliveredKwh" DECIMAL(18,3) NOT NULL,
    "debitedKwh" DECIMAL(18,3) NOT NULL,
    "feeKwh" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "conversionRate" DECIMAL(12,4) NOT NULL,
    "burnedTokenIds" TEXT[],
    "status" "RoamingSettlementStatus" NOT NULL DEFAULT 'OPEN',
    "nettedAt" TIMESTAMP(3),
    "nettedRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoamingSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoamingSettlement_paymentId_key" ON "RoamingSettlement"("paymentId");

-- CreateIndex
CREATE INDEX "RoamingSettlement_agreementId_status_idx" ON "RoamingSettlement"("agreementId", "status");

-- CreateIndex
CREATE INDEX "RoamingSettlement_userId_agreementId_createdAt_idx" ON "RoamingSettlement"("userId", "agreementId", "createdAt");

-- AddForeignKey
ALTER TABLE "RoamingSettlement" ADD CONSTRAINT "RoamingSettlement_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RoamingAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoamingSettlement" ADD CONSTRAINT "RoamingSettlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoamingSettlement" ADD CONSTRAINT "RoamingSettlement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
