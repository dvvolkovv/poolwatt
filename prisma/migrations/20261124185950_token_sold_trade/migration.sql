-- AlterTable
ALTER TABLE "EnergyToken" ADD COLUMN     "soldTradeId" TEXT;

-- CreateIndex
CREATE INDEX "EnergyToken_soldTradeId_idx" ON "EnergyToken"("soldTradeId");

-- AddForeignKey
ALTER TABLE "EnergyToken" ADD CONSTRAINT "EnergyToken_soldTradeId_fkey" FOREIGN KEY ("soldTradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
