-- CreateTable
CREATE TABLE "SubpartnerAgreement" (
    "id" TEXT NOT NULL,
    "headId" TEXT NOT NULL,
    "subId" TEXT NOT NULL,
    "chargeFeePct" DECIMAL(5,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubpartnerAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubpartnerAgreement_subId_active_idx" ON "SubpartnerAgreement"("subId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "SubpartnerAgreement_headId_subId_key" ON "SubpartnerAgreement"("headId", "subId");

-- AddForeignKey
ALTER TABLE "SubpartnerAgreement" ADD CONSTRAINT "SubpartnerAgreement_headId_fkey" FOREIGN KEY ("headId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubpartnerAgreement" ADD CONSTRAINT "SubpartnerAgreement_subId_fkey" FOREIGN KEY ("subId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
