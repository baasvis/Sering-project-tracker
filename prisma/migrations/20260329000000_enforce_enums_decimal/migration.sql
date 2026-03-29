-- Convert String columns to their proper enum types
-- All existing data has been verified to contain only valid enum values

-- Project.status: text -> "ProjectStatus" enum
ALTER TABLE "Project" ALTER COLUMN "status" SET DATA TYPE "ProjectStatus" USING "status"::"ProjectStatus";
ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'active'::"ProjectStatus";

-- Task.status: text -> "TaskStatus" enum
ALTER TABLE "Task" ALTER COLUMN "status" SET DATA TYPE "TaskStatus" USING "status"::"TaskStatus";
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'todo'::"TaskStatus";

-- ShoppingItem.type: text -> "ShoppingItemType" enum
ALTER TABLE "ShoppingItem" ALTER COLUMN "type" SET DATA TYPE "ShoppingItemType" USING "type"::"ShoppingItemType";
ALTER TABLE "ShoppingItem" ALTER COLUMN "type" SET DEFAULT 'product'::"ShoppingItemType";

-- Convert Float money columns to Decimal(10,2) for precision
ALTER TABLE "ShoppingItem" ALTER COLUMN "pricePerItem" SET DATA TYPE DECIMAL(10,2);
ALTER TABLE "ShoppingItem" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(10,2);

-- Add ON DELETE RESTRICT to Project.groupId (if not already present)
-- Drop existing FK and re-add with RESTRICT
ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_groupId_fkey";
ALTER TABLE "Project" ADD CONSTRAINT "Project_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
