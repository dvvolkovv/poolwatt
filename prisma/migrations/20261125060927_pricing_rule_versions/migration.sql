-- CreateEnum
CREATE TYPE "PricingScope" AS ENUM ('POINT_TARIFF', 'NETWORK_PRICE', 'RESERVATION_POLICY', 'SALE_RULES', 'SUBPARTNER_FEE');

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "pricingVersion" INTEGER;

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "scope" "PricingScope" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "operatorId" TEXT,
    "companyId" TEXT,
    "version" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PricingRule_scope_scopeId_activeFrom_idx" ON "PricingRule"("scope", "scopeId", "activeFrom");

-- CreateIndex
CREATE INDEX "PricingRule_operatorId_activeFrom_idx" ON "PricingRule"("operatorId", "activeFrom");

-- CreateIndex
CREATE INDEX "PricingRule_companyId_activeFrom_idx" ON "PricingRule"("companyId", "activeFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_scope_scopeId_version_key" ON "PricingRule"("scope", "scopeId", "version");

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
