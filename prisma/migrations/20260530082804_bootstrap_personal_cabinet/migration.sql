-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "RenewableSource" AS ENUM ('SOLAR', 'WIND', 'HYDRO', 'BIOMASS', 'GEOTHERMAL', 'HYBRID');

-- CreateEnum
CREATE TYPE "ProducerSource" AS ENUM ('AUTO_FEED', 'ADMIN_ADDED', 'SELF_ENROLLED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OPEN', 'FILLED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('PENDING', 'ACTIVE', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdminAction" AS ENUM ('APPROVE_REQUEST', 'REJECT_REQUEST', 'ADD_PRODUCER', 'TOGGLE_PRODUCER_ACTIVE', 'SET_USER_ROLE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "preferredLocale" TEXT NOT NULL DEFAULT 'en',
    "preferredCurrency" TEXT NOT NULL DEFAULT 'USD',
    "preferredTheme" TEXT NOT NULL DEFAULT 'system',
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "ChargerFavorite" (
    "userId" TEXT NOT NULL,
    "chargerId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargerFavorite_pkey" PRIMARY KEY ("userId","chargerId")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Producer" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "primarySource" "RenewableSource" NOT NULL,
    "sourceMix" JSONB,
    "capacityKwh" DECIMAL(12,3) NOT NULL,
    "inverterKw" DECIMAL(8,3) NOT NULL,
    "installedAt" TIMESTAMP(3),
    "source" "ProducerSource" NOT NULL DEFAULT 'SELF_ENROLLED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rank" INTEGER NOT NULL,
    "logoUrl" TEXT,
    "bannerUrl" TEXT,
    "bio" TEXT,
    "websiteUrl" TEXT,
    "twitterUrl" TEXT,
    "ownerId" TEXT,
    "addedByAdminId" TEXT,
    "approvedFromRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadataFetchedAt" TIMESTAMP(3),

    CONSTRAINT "Producer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProducerSnapshot" (
    "id" TEXT NOT NULL,
    "producerId" TEXT NOT NULL,
    "stateOfChargePct" DOUBLE PRECISION NOT NULL,
    "availableKwh" DECIMAL(12,3) NOT NULL,
    "delivered24hKwh" DECIMAL(12,3) NOT NULL,
    "deliveredLifetimeKwh" DECIMAL(16,3) NOT NULL,
    "avgPricePerKwhUsd" DECIMAL(10,6) NOT NULL,
    "pctChange24h" DOUBLE PRECISION,
    "pctChange7d" DOUBLE PRECISION,
    "uptimePct" DOUBLE PRECISION,
    "carbonOffsetKgCo2e" DECIMAL(14,3),
    "weatherCondition" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProducerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GridStats" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "totalCapacityKwh" DECIMAL(18,3) NOT NULL,
    "totalDelivered24hKwh" DECIMAL(18,3) NOT NULL,
    "totalLifetimeKwh" DECIMAL(20,3) NOT NULL,
    "activeProducers" INTEGER NOT NULL,
    "activeHubs" INTEGER NOT NULL,
    "solarSharePct" DOUBLE PRECISION NOT NULL,
    "windSharePct" DOUBLE PRECISION NOT NULL,
    "hydroSharePct" DOUBLE PRECISION NOT NULL,
    "otherSharePct" DOUBLE PRECISION NOT NULL,
    "carbonOffset24hKgCo2e" DECIMAL(16,3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GridStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hub" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "region" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "logoUrl" TEXT,
    "isOperational" BOOLEAN NOT NULL DEFAULT true,
    "yearEstablished" INTEGER,
    "capacityKwh" DOUBLE PRECISION NOT NULL,
    "throughput24hKwh" DOUBLE PRECISION NOT NULL,
    "trustScore" INTEGER,
    "trustScoreRank" INTEGER,
    "url" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HubWatchlist" (
    "userId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HubWatchlist_pkey" PRIMARY KEY ("userId","hubId")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "userId" TEXT NOT NULL,
    "producerId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("userId","producerId")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "producerId" TEXT NOT NULL,
    "kwh" DECIMAL(12,3) NOT NULL,
    "pricePerKwhUsd" DECIMAL(10,6) NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "producerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "hubId" TEXT,
    "kwh" DECIMAL(12,3) NOT NULL,
    "pricePerKwhUsd" DECIMAL(10,6) NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'PENDING',
    "signedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProducerRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT,
    "primarySource" "RenewableSource" NOT NULL,
    "capacityKwh" DECIMAL(12,3) NOT NULL,
    "inverterKw" DECIMAL(8,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProducerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "AdminAction" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "ChargerFavorite_userId_addedAt_idx" ON "ChargerFavorite"("userId", "addedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Producer_slug_key" ON "Producer"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Producer_handle_key" ON "Producer"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Producer_approvedFromRequestId_key" ON "Producer"("approvedFromRequestId");

-- CreateIndex
CREATE INDEX "Producer_country_rank_idx" ON "Producer"("country", "rank");

-- CreateIndex
CREATE INDEX "Producer_primarySource_idx" ON "Producer"("primarySource");

-- CreateIndex
CREATE INDEX "ProducerSnapshot_producerId_fetchedAt_idx" ON "ProducerSnapshot"("producerId", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Hub_slug_key" ON "Hub"("slug");

-- CreateIndex
CREATE INDEX "Hub_trustScoreRank_idx" ON "Hub"("trustScoreRank");

-- CreateIndex
CREATE INDEX "HubWatchlist_userId_idx" ON "HubWatchlist"("userId");

-- CreateIndex
CREATE INDEX "Watchlist_userId_idx" ON "Watchlist"("userId");

-- CreateIndex
CREATE INDEX "Offer_status_startAt_idx" ON "Offer"("status", "startAt");

-- CreateIndex
CREATE INDEX "Offer_producerId_status_idx" ON "Offer"("producerId", "status");

-- CreateIndex
CREATE INDEX "Contract_buyerId_createdAt_idx" ON "Contract"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "Contract_producerId_createdAt_idx" ON "Contract"("producerId", "createdAt");

-- CreateIndex
CREATE INDEX "Contract_status_createdAt_idx" ON "Contract"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProducerRequest_userId_createdAt_idx" ON "ProducerRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProducerRequest_status_createdAt_idx" ON "ProducerRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorId_createdAt_idx" ON "AdminAuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargerFavorite" ADD CONSTRAINT "ChargerFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Producer" ADD CONSTRAINT "Producer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Producer" ADD CONSTRAINT "Producer_addedByAdminId_fkey" FOREIGN KEY ("addedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Producer" ADD CONSTRAINT "Producer_approvedFromRequestId_fkey" FOREIGN KEY ("approvedFromRequestId") REFERENCES "ProducerRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProducerSnapshot" ADD CONSTRAINT "ProducerSnapshot_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "Producer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubWatchlist" ADD CONSTRAINT "HubWatchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubWatchlist" ADD CONSTRAINT "HubWatchlist_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "Producer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "Producer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "Producer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProducerRequest" ADD CONSTRAINT "ProducerRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProducerRequest" ADD CONSTRAINT "ProducerRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
