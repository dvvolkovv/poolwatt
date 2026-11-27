-- CreateEnum
CREATE TYPE "ReceiptClaimReason" AS ENUM ('REQUISITES', 'VAT', 'SESSION_DETAILS', 'AMOUNTS', 'OTHER');

-- CreateEnum
CREATE TYPE "ReceiptClaimStatus" AS ENUM ('OPEN', 'CORRECTED', 'REJECTED');

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "correctsReceiptId" TEXT,
ADD COLUMN     "document" JSONB,
ADD COLUMN     "documentVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ReceiptClaim" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "operatorId" TEXT,
    "claimedById" TEXT NOT NULL,
    "reason" "ReceiptClaimReason" NOT NULL,
    "comment" TEXT NOT NULL,
    "status" "ReceiptClaimStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openKey" TEXT,

    CONSTRAINT "ReceiptClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptCorrection" (
    "id" TEXT NOT NULL,
    "claimId" TEXT,
    "receiptId" TEXT NOT NULL,
    "issuedReceiptId" TEXT NOT NULL,
    "correctedById" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReceiptClaim_status_createdAt_idx" ON "ReceiptClaim"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReceiptClaim_operatorId_status_idx" ON "ReceiptClaim"("operatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptClaim_receiptId_openKey_key" ON "ReceiptClaim"("receiptId", "openKey");

-- CreateIndex
CREATE INDEX "ReceiptCorrection_receiptId_idx" ON "ReceiptCorrection"("receiptId");

-- CreateIndex
CREATE INDEX "ReceiptCorrection_createdAt_idx" ON "ReceiptCorrection"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_correctsReceiptId_key" ON "Receipt"("correctsReceiptId");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_correctsReceiptId_fkey" FOREIGN KEY ("correctsReceiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptClaim" ADD CONSTRAINT "ReceiptClaim_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptClaim" ADD CONSTRAINT "ReceiptClaim_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptClaim" ADD CONSTRAINT "ReceiptClaim_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptClaim" ADD CONSTRAINT "ReceiptClaim_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptCorrection" ADD CONSTRAINT "ReceiptCorrection_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ReceiptClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptCorrection" ADD CONSTRAINT "ReceiptCorrection_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptCorrection" ADD CONSTRAINT "ReceiptCorrection_issuedReceiptId_fkey" FOREIGN KEY ("issuedReceiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptCorrection" ADD CONSTRAINT "ReceiptCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

