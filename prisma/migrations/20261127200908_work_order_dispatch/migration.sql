-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "regions" TEXT[];

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "crewId" TEXT;

-- CreateTable
CREATE TABLE "Crew" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewMember" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "lead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrewMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Crew_operatorId_idx" ON "Crew"("operatorId");

-- CreateIndex
CREATE UNIQUE INDEX "Crew_operatorId_name_key" ON "Crew"("operatorId", "name");

-- CreateIndex
CREATE INDEX "CrewMember_employeeId_idx" ON "CrewMember"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "CrewMember_crewId_employeeId_key" ON "CrewMember"("crewId", "employeeId");

-- CreateIndex
CREATE INDEX "WorkOrder_crewId_status_idx" ON "WorkOrder"("crewId", "status");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
