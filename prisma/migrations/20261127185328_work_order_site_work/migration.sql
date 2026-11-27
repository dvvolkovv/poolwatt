-- CreateEnum
CREATE TYPE "WorkOrderPhotoStage" AS ENUM ('BEFORE', 'AFTER');

-- CreateEnum
CREATE TYPE "WorkOrderSignerKind" AS ENUM ('SITE_CONTACT', 'ENGINEER');

-- CreateTable
CREATE TABLE "WorkOrderTask" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "skipReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderPhoto" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "stage" "WorkOrderPhotoStage" NOT NULL,
    "key" TEXT NOT NULL,
    "takenById" TEXT,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderSignature" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "signerKind" "WorkOrderSignerKind" NOT NULL,
    "signerName" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "signedById" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrderTask_workOrderId_idx" ON "WorkOrderTask"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderTask_workOrderId_position_key" ON "WorkOrderTask"("workOrderId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderPhoto_key_key" ON "WorkOrderPhoto"("key");

-- CreateIndex
CREATE INDEX "WorkOrderPhoto_workOrderId_stage_idx" ON "WorkOrderPhoto"("workOrderId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderSignature_workOrderId_key" ON "WorkOrderSignature"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderSignature_key_key" ON "WorkOrderSignature"("key");

-- AddForeignKey
ALTER TABLE "WorkOrderTask" ADD CONSTRAINT "WorkOrderTask_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderPhoto" ADD CONSTRAINT "WorkOrderPhoto_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderSignature" ADD CONSTRAINT "WorkOrderSignature_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
