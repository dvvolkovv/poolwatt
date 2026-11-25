-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('SCOUTING', 'NEGOTIATION', 'CONTRACT', 'DESIGN', 'INSTALLATION', 'COMMISSIONING', 'PUBLISHED');

-- CreateTable
CREATE TABLE "SiteLead" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "country" TEXT,
    "city" TEXT,
    "addressLine" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "stage" "LeadStage" NOT NULL DEFAULT 'SCOUTING',
    "ownerEmployeeId" TEXT,
    "dueAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "pointId" TEXT,
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadDocument" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteLead_pointId_key" ON "SiteLead"("pointId");

-- CreateIndex
CREATE INDEX "SiteLead_operatorId_stage_position_idx" ON "SiteLead"("operatorId", "stage", "position");

-- CreateIndex
CREATE INDEX "SiteLead_operatorId_dueAt_idx" ON "SiteLead"("operatorId", "dueAt");

-- CreateIndex
CREATE INDEX "LeadNote_leadId_createdAt_idx" ON "LeadNote"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadDocument_storageKey_key" ON "LeadDocument"("storageKey");

-- CreateIndex
CREATE INDEX "LeadDocument_leadId_uploadedAt_idx" ON "LeadDocument"("leadId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "SiteLead" ADD CONSTRAINT "SiteLead_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteLead" ADD CONSTRAINT "SiteLead_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteLead" ADD CONSTRAINT "SiteLead_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "AcceptancePoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SiteLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDocument" ADD CONSTRAINT "LeadDocument_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SiteLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
