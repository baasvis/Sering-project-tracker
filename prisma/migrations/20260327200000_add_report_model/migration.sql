-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "screenshotData" TEXT,
    "reporterName" TEXT NOT NULL,
    "currentPage" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_resolved_createdAt_idx" ON "Report"("resolved", "createdAt");
