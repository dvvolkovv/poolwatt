-- AlterEnum
ALTER TYPE "ClaimEntityType" ADD VALUE 'CHARGER_OPERATOR';

-- CreateTable
CREATE TABLE "ChargerOperator" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "websiteUrl" TEXT,
    "logoUrl" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargerOperator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChargerOperator_slug_key" ON "ChargerOperator"("slug");

-- CreateIndex
CREATE INDEX "ChargerOperator_claimedById_idx" ON "ChargerOperator"("claimedById");

-- AddForeignKey
ALTER TABLE "ChargerOperator" ADD CONSTRAINT "ChargerOperator_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
