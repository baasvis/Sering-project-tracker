-- CreateTable
CREATE TABLE "ToolItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "suggestedBy" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolItem_projectId_approved_idx" ON "ToolItem"("projectId", "approved");

-- AddForeignKey
ALTER TABLE "ToolItem" ADD CONSTRAINT "ToolItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
