-- CreateEnum
CREATE TYPE "CoopMemberStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CoopVoteStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "Cooperative" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cooperative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoopMember" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "status" "CoopMemberStatus" NOT NULL DEFAULT 'PENDING',
    "kycVerifiedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoopMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoopPayout" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "incomeAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "totalShares" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoopPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoopPayoutAllocation" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "CoopPayoutAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoopVote" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[],
    "status" "CoopVoteStatus" NOT NULL DEFAULT 'OPEN',
    "opensAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "winner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoopVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoopBallot" (
    "id" TEXT NOT NULL,
    "voteId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "option" TEXT NOT NULL,
    "castAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoopBallot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoamingAgreement" (
    "id" TEXT NOT NULL,
    "homeZoneId" TEXT NOT NULL,
    "visitedZoneId" TEXT NOT NULL,
    "partnerName" TEXT NOT NULL,
    "feePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyLimitKwh" DECIMAL(18,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoamingAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cooperative_companyId_key" ON "Cooperative"("companyId");

-- CreateIndex
CREATE INDEX "Cooperative_zoneId_idx" ON "Cooperative"("zoneId");

-- CreateIndex
CREATE INDEX "CoopMember_coopId_status_idx" ON "CoopMember"("coopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CoopMember_coopId_userId_key" ON "CoopMember"("coopId", "userId");

-- CreateIndex
CREATE INDEX "CoopPayout_coopId_periodStart_idx" ON "CoopPayout"("coopId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "CoopPayout_coopId_periodStart_periodEnd_key" ON "CoopPayout"("coopId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "CoopPayoutAllocation_memberId_idx" ON "CoopPayoutAllocation"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "CoopPayoutAllocation_payoutId_memberId_key" ON "CoopPayoutAllocation"("payoutId", "memberId");

-- CreateIndex
CREATE INDEX "CoopVote_coopId_status_idx" ON "CoopVote"("coopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CoopBallot_voteId_memberId_key" ON "CoopBallot"("voteId", "memberId");

-- CreateIndex
CREATE INDEX "RoamingAgreement_visitedZoneId_idx" ON "RoamingAgreement"("visitedZoneId");

-- CreateIndex
CREATE UNIQUE INDEX "RoamingAgreement_homeZoneId_visitedZoneId_key" ON "RoamingAgreement"("homeZoneId", "visitedZoneId");

-- AddForeignKey
ALTER TABLE "Cooperative" ADD CONSTRAINT "Cooperative_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cooperative" ADD CONSTRAINT "Cooperative_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "GridZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopMember" ADD CONSTRAINT "CoopMember_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "Cooperative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopMember" ADD CONSTRAINT "CoopMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopPayout" ADD CONSTRAINT "CoopPayout_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "Cooperative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopPayoutAllocation" ADD CONSTRAINT "CoopPayoutAllocation_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "CoopPayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopPayoutAllocation" ADD CONSTRAINT "CoopPayoutAllocation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CoopMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopVote" ADD CONSTRAINT "CoopVote_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "Cooperative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopBallot" ADD CONSTRAINT "CoopBallot_voteId_fkey" FOREIGN KEY ("voteId") REFERENCES "CoopVote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopBallot" ADD CONSTRAINT "CoopBallot_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CoopMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoamingAgreement" ADD CONSTRAINT "RoamingAgreement_homeZoneId_fkey" FOREIGN KEY ("homeZoneId") REFERENCES "GridZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoamingAgreement" ADD CONSTRAINT "RoamingAgreement_visitedZoneId_fkey" FOREIGN KEY ("visitedZoneId") REFERENCES "GridZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
