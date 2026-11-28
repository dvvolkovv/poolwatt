-- CreateEnum
CREATE TYPE "ChatRoomKind" AS ENUM ('NETWORK', 'CREW', 'WORK_ORDER');

-- CreateEnum
CREATE TYPE "ChatAuthorKind" AS ENUM ('STAFF', 'SYSTEM');

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "kind" "ChatRoomKind" NOT NULL,
    "operatorId" TEXT,
    "crewId" TEXT,
    "workOrderId" TEXT,
    "authorKind" "ChatAuthorKind" NOT NULL DEFAULT 'STAFF',
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatRead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roomKey" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMessage_operatorId_createdAt_idx" ON "ChatMessage"("operatorId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_crewId_createdAt_idx" ON "ChatMessage"("crewId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_workOrderId_createdAt_idx" ON "ChatMessage"("workOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatRead_userId_idx" ON "ChatRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatRead_userId_roomKey_key" ON "ChatRead"("userId", "roomKey");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRead" ADD CONSTRAINT "ChatRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
