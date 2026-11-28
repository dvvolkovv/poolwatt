-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tileAccent" TEXT NOT NULL DEFAULT 'accent',
ADD COLUMN     "tileOrder" JSONB;
