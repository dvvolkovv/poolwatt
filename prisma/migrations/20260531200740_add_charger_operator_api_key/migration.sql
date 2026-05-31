-- CreateTable
CREATE TABLE "ChargerOperatorApiKey" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargerOperatorApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChargerOperatorApiKey_tokenHash_key" ON "ChargerOperatorApiKey"("tokenHash");

-- CreateIndex
CREATE INDEX "ChargerOperatorApiKey_operatorId_idx" ON "ChargerOperatorApiKey"("operatorId");

-- CreateIndex
CREATE INDEX "ChargerOperatorApiKey_tokenHash_idx" ON "ChargerOperatorApiKey"("tokenHash");

-- AddForeignKey
ALTER TABLE "ChargerOperatorApiKey" ADD CONSTRAINT "ChargerOperatorApiKey_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
