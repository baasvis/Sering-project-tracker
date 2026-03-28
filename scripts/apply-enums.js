/**
 * One-time migration: convert string columns to PostgreSQL enums.
 * Runs the migration SQL directly, skipping steps that already exist.
 * Safe to run multiple times (idempotent).
 */
const { PrismaClient } = require('@prisma/client');

async function applyEnums() {
  const prisma = new PrismaClient();

  try {
    console.log('[migrate] Checking if enum migration is needed...');

    // Check if enums already exist
    const result = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'ProjectStatus'
      ) AS exists
    `;

    if (result[0].exists) {
      console.log('[migrate] Enums already exist, skipping migration.');
      return;
    }

    console.log('[migrate] Applying enum migration...');

    // Create enum types
    await prisma.$executeRawUnsafe(`CREATE TYPE "ProjectStatus" AS ENUM ('active', 'completed', 'archived')`);
    await prisma.$executeRawUnsafe(`CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'done')`);
    await prisma.$executeRawUnsafe(`CREATE TYPE "ProjectTier" AS ENUM ('mvp', 'medium', 'next_level')`);
    await prisma.$executeRawUnsafe(`CREATE TYPE "JoinType" AS ENUM ('open', 'contact', 'closed')`);
    await prisma.$executeRawUnsafe(`CREATE TYPE "ShoppingItemType" AS ENUM ('product', 'cost')`);
    await prisma.$executeRawUnsafe(`CREATE TYPE "MediaType" AS ENUM ('photo', 'voice')`);
    await prisma.$executeRawUnsafe(`CREATE TYPE "CommentTargetType" AS ENUM ('group', 'project', 'task', 'announcement')`);
    await prisma.$executeRawUnsafe(`CREATE TYPE "MediaParentType" AS ENUM ('task', 'project', 'announcement', 'comment')`);
    console.log('[migrate] Enum types created.');

    // Normalize invalid data before casting
    await prisma.$executeRawUnsafe(`UPDATE "Project" SET "joinType" = 'open' WHERE "joinType" NOT IN ('open', 'contact', 'closed') AND "joinType" IS NOT NULL`);
    await prisma.$executeRawUnsafe(`UPDATE "Project" SET "tier" = NULL WHERE "tier" NOT IN ('mvp', 'medium', 'next_level') AND "tier" IS NOT NULL`);
    console.log('[migrate] Data normalized.');

    // Convert columns to enums
    await prisma.$executeRawUnsafe(`ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'active'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Project" ALTER COLUMN "status" TYPE "ProjectStatus" USING "status"::"ProjectStatus"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'active'`);

    await prisma.$executeRawUnsafe(`ALTER TABLE "Project" ALTER COLUMN "tier" DROP DEFAULT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Project" ALTER COLUMN "tier" TYPE "ProjectTier" USING "tier"::"ProjectTier"`);

    await prisma.$executeRawUnsafe(`ALTER TABLE "Project" ALTER COLUMN "joinType" DROP DEFAULT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Project" ALTER COLUMN "joinType" TYPE "JoinType" USING "joinType"::"JoinType"`);

    await prisma.$executeRawUnsafe(`ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'todo'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus" USING "status"::"TaskStatus"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'todo'`);

    await prisma.$executeRawUnsafe(`ALTER TABLE "Comment" ALTER COLUMN "targetType" TYPE "CommentTargetType" USING "targetType"::"CommentTargetType"`);

    await prisma.$executeRawUnsafe(`ALTER TABLE "ShoppingItem" ALTER COLUMN "type" SET DEFAULT 'product'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ShoppingItem" ALTER COLUMN "type" TYPE "ShoppingItemType" USING "type"::"ShoppingItemType"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ShoppingItem" ALTER COLUMN "type" SET DEFAULT 'product'`);

    await prisma.$executeRawUnsafe(`ALTER TABLE "Media" ALTER COLUMN "type" TYPE "MediaType" USING "type"::"MediaType"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Media" ALTER COLUMN "parentType" TYPE "MediaParentType" USING "parentType"::"MediaParentType"`);
    console.log('[migrate] Columns converted to enums.');

    // Add/replace indexes
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Task_projectId_idx"`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Task_projectId_status_idx" ON "Task"("projectId", "status")`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "ShoppingItem_projectId_idx"`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ShoppingItem_projectId_approved_idx" ON "ShoppingItem"("projectId", "approved")`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Media_parentType_parentId_idx"`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Media_parentType_parentId_createdAt_idx" ON "Media"("parentType", "parentId", "createdAt")`);

    // New indexes from review
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Group_deletedAt_idx" ON "Group"("deletedAt")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Task_projectId_deadline_idx" ON "Task"("projectId", "deadline")`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Comment_targetType_targetId_idx"`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Comment_targetType_targetId_createdAt_idx" ON "Comment"("targetType", "targetId", "createdAt")`);
    console.log('[migrate] Indexes updated.');

    console.log('[migrate] Enum migration complete!');
  } catch (err) {
    console.error('[migrate] Migration failed.');
    console.error('[migrate] Error name:', err.name);
    console.error('[migrate] Error message:', err.message || '(empty)');
    console.error('[migrate] Error code:', err.code || '(none)');
    console.error('[migrate] Error meta:', JSON.stringify(err.meta || {}));
    console.error('[migrate] Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

applyEnums();
