-- CreateTable
CREATE TABLE "PointTemplate" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tariffs" JSONB NOT NULL DEFAULT '[]',
    "open24" BOOLEAN NOT NULL DEFAULT false,
    "openHours" JSONB,
    "holidayNote" TEXT,
    "paymentMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastAppliedAt" TIMESTAMP(3),
    "lastAppliedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointTemplate_operatorId_updatedAt_idx" ON "PointTemplate"("operatorId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointTemplate_operatorId_name_key" ON "PointTemplate"("operatorId", "name");

-- AddForeignKey
ALTER TABLE "PointTemplate" ADD CONSTRAINT "PointTemplate_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
