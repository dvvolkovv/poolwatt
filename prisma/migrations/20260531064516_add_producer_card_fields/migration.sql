-- CreateEnum
CREATE TYPE "ProducerCategory" AS ENUM ('ENERGY_PRODUCER', 'EQUIPMENT_MANUFACTURER');

-- AlterTable
ALTER TABLE "Producer" ADD COLUMN     "category" "ProducerCategory" NOT NULL DEFAULT 'ENERGY_PRODUCER',
ADD COLUMN     "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "manufactures" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ProducerProfile" (
    "producerId" TEXT NOT NULL,
    "description" TEXT,
    "founded" INTEGER,
    "employees" TEXT,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "ceo" TEXT,
    "stockTicker" TEXT,
    "certifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keyProducts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProducerProfile_pkey" PRIMARY KEY ("producerId")
);

-- AddForeignKey
ALTER TABLE "ProducerProfile" ADD CONSTRAINT "ProducerProfile_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "Producer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
