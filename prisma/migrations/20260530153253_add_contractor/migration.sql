-- CreateEnum
CREATE TYPE "ContractorEntityType" AS ENUM ('LEGAL_ENTITY', 'SOLE_TRADER', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "ContractorWorkCategory" AS ENUM ('DESIGN', 'MANUFACTURE', 'SUPPLY', 'INSTALLATION', 'COMMISSIONING', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ContractorRenewableType" AS ENUM ('SOLAR', 'WIND', 'HYDRO', 'BIOMASS', 'GEOTHERMAL', 'HYBRID');

-- CreateEnum
CREATE TYPE "ContractorStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ContractorMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateTable
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "entityType" "ContractorEntityType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "registrationNumber" TEXT,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "foundedYear" INTEGER,
    "workCategories" "ContractorWorkCategory"[],
    "renewableTypes" "ContractorRenewableType"[],
    "countriesServed" TEXT[],
    "bio" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "logoUrl" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "status" "ContractorStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorMember" (
    "contractorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ContractorMemberRole" NOT NULL DEFAULT 'OWNER',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractorMember_pkey" PRIMARY KEY ("contractorId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contractor_slug_key" ON "Contractor"("slug");

-- CreateIndex
CREATE INDEX "Contractor_status_createdAt_idx" ON "Contractor"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Contractor_country_status_idx" ON "Contractor"("country", "status");

-- CreateIndex
CREATE INDEX "ContractorMember_userId_idx" ON "ContractorMember"("userId");

-- AddForeignKey
ALTER TABLE "Contractor" ADD CONSTRAINT "Contractor_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorMember" ADD CONSTRAINT "ContractorMember_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorMember" ADD CONSTRAINT "ContractorMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
