-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('BASIC', 'EXTENDED', 'CORPORATE');

-- CreateTable
CREATE TABLE "PlatformFeePlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL DEFAULT 'BASIC',
    "participantType" "CompanyType",
    "tradeFeePct" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "chargeFeePct" DECIMAL(5,2) NOT NULL DEFAULT 2,
    "bookingFeePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "subscriptionFiat" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "subscriptionPeriod" TEXT NOT NULL DEFAULT 'month',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "includedInvoices" INTEGER,
    "includedCampaigns" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformFeePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "operatorId" TEXT,
    "planId" TEXT NOT NULL,
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformFeePlan_name_key" ON "PlatformFeePlan"("name");

-- CreateIndex
CREATE INDEX "PlatformFeePlan_participantType_active_idx" ON "PlatformFeePlan"("participantType", "active");

-- CreateIndex
CREATE INDEX "PartnerPlan_planId_idx" ON "PartnerPlan"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPlan_companyId_key" ON "PartnerPlan"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPlan_operatorId_key" ON "PartnerPlan"("operatorId");

-- AddForeignKey
ALTER TABLE "PartnerPlan" ADD CONSTRAINT "PartnerPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPlan" ADD CONSTRAINT "PartnerPlan_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPlan" ADD CONSTRAINT "PartnerPlan_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PlatformFeePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
