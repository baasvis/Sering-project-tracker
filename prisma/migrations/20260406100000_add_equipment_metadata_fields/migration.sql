-- AlterTable: Add metadata fields to ShoppingItem
ALTER TABLE "ShoppingItem" ADD COLUMN "notes" TEXT;
ALTER TABLE "ShoppingItem" ADD COLUMN "category" TEXT;
ALTER TABLE "ShoppingItem" ADD COLUMN "importance" TEXT;
ALTER TABLE "ShoppingItem" ADD COLUMN "assignedTo" TEXT;

-- AlterTable: Add metadata fields to ToolItem
ALTER TABLE "ToolItem" ADD COLUMN "link" TEXT;
ALTER TABLE "ToolItem" ADD COLUMN "notes" TEXT;
ALTER TABLE "ToolItem" ADD COLUMN "category" TEXT;
ALTER TABLE "ToolItem" ADD COLUMN "importance" TEXT;
ALTER TABLE "ToolItem" ADD COLUMN "assignedTo" TEXT;
