-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('PRODUCER', 'WHOLESALE', 'COOPERATIVE', 'OPERATOR');

-- CreateEnum
CREATE TYPE "KybStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ListingApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('SOLAR', 'WIND', 'BIOGAS', 'HYDRO', 'STORAGE', 'MIXED');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('DRAFT', 'REVIEW', 'TEST', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ReadingValidationStatus" AS ENUM ('RECEIVED', 'VALID', 'SUSPICIOUS', 'REJECTED');

-- CreateEnum
CREATE TYPE "EnergyTokenStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'STORED', 'SOLD', 'BURNED', 'ROUTED');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('MARKET', 'LIMIT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "SettlementAccountStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TokenTransferStatus" AS ENUM ('CREATED', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "GridZone" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "spotSource" TEXT,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "corridorPct" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "spotPrice" DECIMAL(12,4),
    "spotPriceAt" TIMESTAMP(3),
    "aggregatorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GridZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "regNumber" TEXT NOT NULL,
    "vatNumber" TEXT,
    "type" "CompanyType" NOT NULL,
    "kybStatus" "KybStatus" NOT NULL DEFAULT 'PENDING',
    "screeningNote" TEXT,
    "website" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "feePlanId" TEXT,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingApplication" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "ListingApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "documents" JSONB NOT NULL DEFAULT '[]',
    "reviewerId" TEXT,
    "decisionComment" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "name" TEXT NOT NULL,
    "capacityKw" DECIMAL(12,3) NOT NULL,
    "storageKwh" DECIMAL(12,3),
    "storedKwh" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gridZoneId" TEXT NOT NULL,
    "meterId" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'DRAFT',
    "goCertificateRef" TEXT,
    "telemetryCleanSince" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "minSalePrice" DECIMAL(12,4),
    "shareToMarketPct" INTEGER NOT NULL DEFAULT 100,
    "shareToStoragePct" INTEGER NOT NULL DEFAULT 0,
    "shareToSelfPct" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetApiKey" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "label" TEXT,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AssetApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "intervalStart" TIMESTAMP(3) NOT NULL,
    "intervalEnd" TIMESTAMP(3) NOT NULL,
    "energyKwh" DECIMAL(18,3) NOT NULL,
    "source" TEXT NOT NULL,
    "validationStatus" "ReadingValidationStatus" NOT NULL DEFAULT 'RECEIVED',
    "validationNote" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mintedAt" TIMESTAMP(3),

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnergyToken" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "readingId" TEXT,
    "parentId" TEXT,
    "intervalStart" TIMESTAMP(3) NOT NULL,
    "amountKwh" DECIMAL(18,3) NOT NULL,
    "status" "EnergyTokenStatus" NOT NULL DEFAULT 'AVAILABLE',
    "goCertificateRef" TEXT,
    "ownerWalletId" TEXT,
    "routedTo" TEXT,
    "storedInAssetId" TEXT,
    "mintedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "burnedAt" TIMESTAMP(3),

    CONSTRAINT "EnergyToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "kwhBalance" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "fiatBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reservedFiat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "type" "OrderType" NOT NULL,
    "intervalStart" TIMESTAMP(3),
    "amountKwh" DECIMAL(18,3) NOT NULL,
    "filledKwh" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "limitPrice" DECIMAL(12,4),
    "avgPrice" DECIMAL(12,4),
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "reservedFiat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rejectReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "buyOrderId" TEXT NOT NULL,
    "sellOrderId" TEXT NOT NULL,
    "amountKwh" DECIMAL(18,3) NOT NULL,
    "price" DECIMAL(12,4) NOT NULL,
    "buyerFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sellerFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "chargePointId" TEXT,
    "requestedKwh" DECIMAL(18,3) NOT NULL,
    "kwhFromBalance" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "kwhBought" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "authorizedFiat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountFiat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "failureReason" TEXT,
    "cardId" TEXT,
    "marketOrderId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorizedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT,
    "tradeId" TEXT,
    "burnedTokenIds" TEXT[],
    "totalKwh" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "totalFiat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "breakdown" JSONB NOT NULL DEFAULT '{}',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT,
    "iban" TEXT NOT NULL,
    "bic" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "SettlementAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "bookedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenTransfer" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "fromWalletId" TEXT NOT NULL,
    "toWalletId" TEXT NOT NULL,
    "amountKwh" DECIMAL(18,3) NOT NULL,
    "note" TEXT,
    "status" "TokenTransferStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "TokenTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "participantType" "CompanyType",
    "tradeFeePct" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "chargeFeePct" DECIMAL(5,2) NOT NULL DEFAULT 2,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GridZone_code_key" ON "GridZone"("code");

-- CreateIndex
CREATE INDEX "Company_type_kybStatus_idx" ON "Company"("type", "kybStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Company_country_regNumber_key" ON "Company"("country", "regNumber");

-- CreateIndex
CREATE INDEX "ListingApplication_status_submittedAt_idx" ON "ListingApplication"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "ListingApplication_companyId_idx" ON "ListingApplication"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_meterId_key" ON "Asset"("meterId");

-- CreateIndex
CREATE INDEX "Asset_companyId_status_idx" ON "Asset"("companyId", "status");

-- CreateIndex
CREATE INDEX "Asset_gridZoneId_status_idx" ON "Asset"("gridZoneId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssetApiKey_tokenHash_key" ON "AssetApiKey"("tokenHash");

-- CreateIndex
CREATE INDEX "AssetApiKey_assetId_idx" ON "AssetApiKey"("assetId");

-- CreateIndex
CREATE INDEX "MeterReading_assetId_intervalStart_idx" ON "MeterReading"("assetId", "intervalStart");

-- CreateIndex
CREATE INDEX "MeterReading_validationStatus_idx" ON "MeterReading"("validationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_assetId_intervalStart_key" ON "MeterReading"("assetId", "intervalStart");

-- CreateIndex
CREATE UNIQUE INDEX "EnergyToken_readingId_key" ON "EnergyToken"("readingId");

-- CreateIndex
CREATE INDEX "EnergyToken_assetId_intervalStart_idx" ON "EnergyToken"("assetId", "intervalStart");

-- CreateIndex
CREATE INDEX "EnergyToken_zoneId_status_intervalStart_idx" ON "EnergyToken"("zoneId", "status", "intervalStart");

-- CreateIndex
CREATE INDEX "EnergyToken_ownerWalletId_status_idx" ON "EnergyToken"("ownerWalletId", "status");

-- CreateIndex
CREATE INDEX "Wallet_zoneId_idx" ON "Wallet"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_ownerUserId_zoneId_key" ON "Wallet"("ownerUserId", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_zoneId_intervalStart_side_status_limitPrice_createdAt_idx" ON "Order"("zoneId", "intervalStart", "side", "status", "limitPrice", "createdAt");

-- CreateIndex
CREATE INDEX "Order_walletId_status_idx" ON "Order"("walletId", "status");

-- CreateIndex
CREATE INDEX "Trade_zoneId_executedAt_idx" ON "Trade"("zoneId", "executedAt");

-- CreateIndex
CREATE INDEX "Trade_buyOrderId_idx" ON "Trade"("buyOrderId");

-- CreateIndex
CREATE INDEX "Trade_sellOrderId_idx" ON "Trade"("sellOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_marketOrderId_key" ON "Payment"("marketOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_walletId_createdAt_idx" ON "Payment"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_tradeId_key" ON "Receipt"("tradeId");

-- CreateIndex
CREATE INDEX "Receipt_issuedAt_idx" ON "Receipt"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAccount_companyId_key" ON "SettlementAccount"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAccount_userId_key" ON "SettlementAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAccount_iban_key" ON "SettlementAccount"("iban");

-- CreateIndex
CREATE INDEX "SettlementEntry_accountId_bookedAt_idx" ON "SettlementEntry"("accountId", "bookedAt");

-- CreateIndex
CREATE INDEX "TokenTransfer_fromWalletId_createdAt_idx" ON "TokenTransfer"("fromWalletId", "createdAt");

-- CreateIndex
CREATE INDEX "TokenTransfer_toWalletId_createdAt_idx" ON "TokenTransfer"("toWalletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeePlan_name_key" ON "FeePlan"("name");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_at_idx" ON "AuditLog"("entity", "entityId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_feePlanId_fkey" FOREIGN KEY ("feePlanId") REFERENCES "FeePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingApplication" ADD CONSTRAINT "ListingApplication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingApplication" ADD CONSTRAINT "ListingApplication_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_gridZoneId_fkey" FOREIGN KEY ("gridZoneId") REFERENCES "GridZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetApiKey" ADD CONSTRAINT "AssetApiKey_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "GridZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyToken" ADD CONSTRAINT "EnergyToken_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyToken" ADD CONSTRAINT "EnergyToken_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "GridZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyToken" ADD CONSTRAINT "EnergyToken_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "MeterReading"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyToken" ADD CONSTRAINT "EnergyToken_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "EnergyToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyToken" ADD CONSTRAINT "EnergyToken_ownerWalletId_fkey" FOREIGN KEY ("ownerWalletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "GridZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "GridZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "GridZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_buyOrderId_fkey" FOREIGN KEY ("buyOrderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_sellOrderId_fkey" FOREIGN KEY ("sellOrderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "GridZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_marketOrderId_fkey" FOREIGN KEY ("marketOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAccount" ADD CONSTRAINT "SettlementAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAccount" ADD CONSTRAINT "SettlementAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementEntry" ADD CONSTRAINT "SettlementEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SettlementAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenTransfer" ADD CONSTRAINT "TokenTransfer_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "GridZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenTransfer" ADD CONSTRAINT "TokenTransfer_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenTransfer" ADD CONSTRAINT "TokenTransfer_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
