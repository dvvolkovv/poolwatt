-- CreateTable
CREATE TABLE "ConnectorStatusLog" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "status" "ConnectorStatus" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "ConnectorStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectorStatusLog_pointId_at_idx" ON "ConnectorStatusLog"("pointId", "at");

-- CreateIndex
CREATE INDEX "ConnectorStatusLog_connectorId_at_idx" ON "ConnectorStatusLog"("connectorId", "at");

-- AddForeignKey
ALTER TABLE "ConnectorStatusLog" ADD CONSTRAINT "ConnectorStatusLog_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "PointConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
