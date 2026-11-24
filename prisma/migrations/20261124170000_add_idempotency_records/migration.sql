-- AlterTable
ALTER TABLE "TokenTransfer" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "response" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_endpoint_userKey_key_key" ON "IdempotencyRecord"("endpoint", "userKey", "key");

-- CreateIndex
CREATE UNIQUE INDEX "TokenTransfer_idempotencyKey_key" ON "TokenTransfer"("idempotencyKey");

