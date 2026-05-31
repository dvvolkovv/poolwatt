-- CreateEnum
CREATE TYPE "ClaimEntityType" AS ENUM ('PRODUCER');

-- AlterTable
ALTER TABLE "Producer" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedById" TEXT;

-- CreateTable
CREATE TABLE "ClaimToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "entityType" "ClaimEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaimToken_token_key" ON "ClaimToken"("token");

-- CreateIndex
CREATE INDEX "ClaimToken_entityType_entityId_idx" ON "ClaimToken"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ClaimToken_userId_idx" ON "ClaimToken"("userId");

-- CreateIndex
CREATE INDEX "Producer_claimedById_idx" ON "Producer"("claimedById");

-- AddForeignKey
ALTER TABLE "ClaimToken" ADD CONSTRAINT "ClaimToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Producer" ADD CONSTRAINT "Producer_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
