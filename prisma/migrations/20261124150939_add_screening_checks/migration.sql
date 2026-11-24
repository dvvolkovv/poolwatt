-- CreateEnum
CREATE TYPE "ScreeningKind" AS ENUM ('KYB', 'SANCTIONS', 'ADVERSE_MEDIA');

-- CreateEnum
CREATE TYPE "ScreeningResult" AS ENUM ('CLEAR', 'HIT', 'INCONCLUSIVE');

-- CreateTable
CREATE TABLE "ScreeningCheck" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ScreeningKind" NOT NULL,
    "result" "ScreeningResult" NOT NULL,
    "provider" TEXT NOT NULL,
    "evidence" TEXT,
    "matches" JSONB NOT NULL DEFAULT '[]',
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScreeningCheck_companyId_kind_checkedAt_idx" ON "ScreeningCheck"("companyId", "kind", "checkedAt");

-- AddForeignKey
ALTER TABLE "ScreeningCheck" ADD CONSTRAINT "ScreeningCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningCheck" ADD CONSTRAINT "ScreeningCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
