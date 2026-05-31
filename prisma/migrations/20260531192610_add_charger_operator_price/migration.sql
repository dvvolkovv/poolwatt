-- AlterTable
ALTER TABLE "ChargerOperator" ADD COLUMN     "priceCurrency" VARCHAR(8),
ADD COLUMN     "pricePerKwh" DECIMAL(8,4),
ADD COLUMN     "priceUpdatedAt" TIMESTAMP(3);
