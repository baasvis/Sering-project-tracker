-- AlterTable: add approval fields to Task
ALTER TABLE "Task" ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Task" ADD COLUMN "suggestedBy" TEXT;

-- AlterTable: add approval fields to Project
ALTER TABLE "Project" ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Project" ADD COLUMN "suggestedBy" TEXT;
