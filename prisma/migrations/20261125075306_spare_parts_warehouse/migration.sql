-- CreateEnum
CREATE TYPE "WarehouseKind" AS ENUM ('CENTRAL', 'REGIONAL', 'VAN');

-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('RECEIPT', 'TRANSFER', 'ISSUE', 'WRITE_OFF', 'RETURN_FAULTY', 'STOCKTAKE');

-- CreateEnum
CREATE TYPE "RestockStatus" AS ENUM ('OPEN', 'ORDERED', 'CLOSED');

-- CreateTable
CREATE TABLE "SparePart" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "compatibleModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unitCostFiat" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "serialTracked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SparePart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WarehouseKind" NOT NULL DEFAULT 'REGIONAL',
    "city" TEXT,
    "keeperEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "minQty" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "qty" INTEGER NOT NULL,
    "workOrderId" TEXT,
    "serialNo" TEXT,
    "unitCostFiat" DECIMAL(12,2),
    "note" TEXT,
    "actorId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestockRequest" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "qtyAtRequest" INTEGER NOT NULL,
    "minQty" INTEGER NOT NULL,
    "suggestedQty" INTEGER NOT NULL,
    "status" "RestockStatus" NOT NULL DEFAULT 'OPEN',
    "notifiedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SparePart_operatorId_name_idx" ON "SparePart"("operatorId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SparePart_operatorId_sku_key" ON "SparePart"("operatorId", "sku");

-- CreateIndex
CREATE INDEX "Warehouse_operatorId_kind_idx" ON "Warehouse"("operatorId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_operatorId_name_key" ON "Warehouse"("operatorId", "name");

-- CreateIndex
CREATE INDEX "StockItem_partId_idx" ON "StockItem"("partId");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_warehouseId_partId_key" ON "StockItem"("warehouseId", "partId");

-- CreateIndex
CREATE INDEX "StockMovement_partId_at_idx" ON "StockMovement"("partId", "at");

-- CreateIndex
CREATE INDEX "StockMovement_fromWarehouseId_at_idx" ON "StockMovement"("fromWarehouseId", "at");

-- CreateIndex
CREATE INDEX "StockMovement_toWarehouseId_at_idx" ON "StockMovement"("toWarehouseId", "at");

-- CreateIndex
CREATE INDEX "StockMovement_workOrderId_idx" ON "StockMovement"("workOrderId");

-- CreateIndex
CREATE INDEX "RestockRequest_status_createdAt_idx" ON "RestockRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RestockRequest_warehouseId_partId_status_key" ON "RestockRequest"("warehouseId", "partId", "status");

-- AddForeignKey
ALTER TABLE "SparePart" ADD CONSTRAINT "SparePart_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ChargerOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_keeperEmployeeId_fkey" FOREIGN KEY ("keeperEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_partId_fkey" FOREIGN KEY ("partId") REFERENCES "SparePart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_partId_fkey" FOREIGN KEY ("partId") REFERENCES "SparePart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
