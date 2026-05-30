-- CreateEnum
CREATE TYPE "BuildRequestClaimStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "BuildRequestClaim" (
    "id" TEXT NOT NULL,
    "buildRequestId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "status" "BuildRequestClaimStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "BuildRequestClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuildRequestClaim_buildRequestId_status_idx" ON "BuildRequestClaim"("buildRequestId", "status");

-- CreateIndex
CREATE INDEX "BuildRequestClaim_contractorId_status_idx" ON "BuildRequestClaim"("contractorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BuildRequestClaim_buildRequestId_contractorId_key" ON "BuildRequestClaim"("buildRequestId", "contractorId");

-- AddForeignKey
ALTER TABLE "BuildRequestClaim" ADD CONSTRAINT "BuildRequestClaim_buildRequestId_fkey" FOREIGN KEY ("buildRequestId") REFERENCES "BuildRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildRequestClaim" ADD CONSTRAINT "BuildRequestClaim_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
