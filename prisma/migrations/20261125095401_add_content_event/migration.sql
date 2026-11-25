-- CreateEnum
CREATE TYPE "ContentEventKind" AS ENUM ('IMPRESSION', 'CLICK', 'VIDEO_VIEW');

-- CreateTable
CREATE TABLE "ContentEvent" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "kind" "ContentEventKind" NOT NULL,
    "userId" TEXT,
    "pointId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentEvent_contentId_kind_at_idx" ON "ContentEvent"("contentId", "kind", "at");

-- CreateIndex
CREATE INDEX "ContentEvent_at_idx" ON "ContentEvent"("at");

-- AddForeignKey
ALTER TABLE "ContentEvent" ADD CONSTRAINT "ContentEvent_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "MarketingContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentEvent" ADD CONSTRAINT "ContentEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
