-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "connectorId" TEXT,
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "pointId" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "verifyCode" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "receiptEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "receiptPush" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "OperatorAccounting" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "legalName" TEXT,
    "regNumber" TEXT,
    "vatNumber" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "country" TEXT,
    "vatRatePct" DECIMAL(5,2),
    "taxNote" TEXT,
    "datevConsultantNo" TEXT,
    "datevClientNo" TEXT,
    "revenueAccount" TEXT,
    "counterAccount" TEXT,
    "fiscalYearStart" INTEGER DEFAULT 1,
    "bmdClientNo" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorAccounting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OperatorAccounting_operatorId_key" ON "OperatorAccounting"("operatorId");

-- CreateIndex
CREATE INDEX "Payment_pointId_capturedAt_idx" ON "Payment"("pointId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_number_key" ON "Receipt"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_verifyCode_key" ON "Receipt"("verifyCode");

-- CreateIndex
CREATE INDEX "Receipt_deliveredAt_idx" ON "Receipt"("deliveredAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "AcceptancePoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "PointConnector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorAccounting" ADD CONSTRAINT "OperatorAccounting_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- §46 — document numbers come from one sequence, so two receipts issued at the
-- same moment cannot claim the same number.
CREATE SEQUENCE IF NOT EXISTS receipt_number_seq START 1;
