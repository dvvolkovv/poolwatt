-- CreateTable
CREATE TABLE "ProducerBuildRequestClaim" (
    "id" TEXT NOT NULL,
    "buildRequestId" TEXT NOT NULL,
    "producerId" TEXT NOT NULL,
    "status" "BuildRequestClaimStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ProducerBuildRequestClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProducerBuildRequestClaim_buildRequestId_status_idx" ON "ProducerBuildRequestClaim"("buildRequestId", "status");

-- CreateIndex
CREATE INDEX "ProducerBuildRequestClaim_producerId_status_idx" ON "ProducerBuildRequestClaim"("producerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProducerBuildRequestClaim_buildRequestId_producerId_key" ON "ProducerBuildRequestClaim"("buildRequestId", "producerId");

-- AddForeignKey
ALTER TABLE "ProducerBuildRequestClaim" ADD CONSTRAINT "ProducerBuildRequestClaim_buildRequestId_fkey" FOREIGN KEY ("buildRequestId") REFERENCES "BuildRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProducerBuildRequestClaim" ADD CONSTRAINT "ProducerBuildRequestClaim_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "Producer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
