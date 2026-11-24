-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_sourceAlertId_fkey" FOREIGN KEY ("sourceAlertId") REFERENCES "AssetAlert"("id") ON DELETE SET NULL ON UPDATE CASCADE;
