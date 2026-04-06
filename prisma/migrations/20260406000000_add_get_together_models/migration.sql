-- CreateEnum
CREATE TYPE "GetTogetherDay" AS ENUM ('day1', 'day2');

-- CreateTable
CREATE TABLE "GetTogetherLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GetTogetherLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GetTogetherBlock" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "day" "GetTogetherDay" NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT,
    "description" TEXT,
    "signupCap" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GetTogetherBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GetTogetherSignup" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GetTogetherSignup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GetTogetherLocation_order_idx" ON "GetTogetherLocation"("order");

-- CreateIndex
CREATE INDEX "GetTogetherBlock_day_locationId_idx" ON "GetTogetherBlock"("day", "locationId");

-- CreateIndex
CREATE INDEX "GetTogetherBlock_projectId_idx" ON "GetTogetherBlock"("projectId");

-- CreateIndex
CREATE INDEX "GetTogetherSignup_blockId_idx" ON "GetTogetherSignup"("blockId");

-- CreateIndex
CREATE UNIQUE INDEX "GetTogetherSignup_blockId_name_key" ON "GetTogetherSignup"("blockId", "name");

-- AddForeignKey
ALTER TABLE "GetTogetherBlock" ADD CONSTRAINT "GetTogetherBlock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GetTogetherLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GetTogetherSignup" ADD CONSTRAINT "GetTogetherSignup_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "GetTogetherBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
