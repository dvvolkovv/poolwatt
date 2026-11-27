-- CreateEnum
CREATE TYPE "TicketAuthorKind" AS ENUM ('CUSTOMER', 'SUPPORT', 'SYSTEM');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "firstRespondedAt" TIMESTAMP(3),
ADD COLUMN     "recoveryNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorKind" "TicketAuthorKind" NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_operatorId_respondBy_idx" ON "Ticket"("operatorId", "respondBy");

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
