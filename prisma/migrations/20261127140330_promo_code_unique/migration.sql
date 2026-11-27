-- DropIndex
DROP INDEX "Campaign_operatorId_promoCode_key";

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_promoCode_key" ON "Campaign"("promoCode");

