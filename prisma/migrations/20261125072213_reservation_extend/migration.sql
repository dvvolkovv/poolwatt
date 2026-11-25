-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "extendCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "extendRemindedAt" TIMESTAMP(3);
