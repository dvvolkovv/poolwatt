-- CreateTable
CREATE TABLE "PointReview" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointReview_pointId_createdAt_idx" ON "PointReview"("pointId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointReview_pointId_userId_key" ON "PointReview"("pointId", "userId");

-- AddForeignKey
ALTER TABLE "PointReview" ADD CONSTRAINT "PointReview_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "AcceptancePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointReview" ADD CONSTRAINT "PointReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
