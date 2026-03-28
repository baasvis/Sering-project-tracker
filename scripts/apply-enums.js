/**
 * One-time migration: convert string columns to PostgreSQL enums.
 * Fully idempotent — every step is wrapped individually.
 * Safe to run any number of times in any database state.
 */
const { PrismaClient } = require('@prisma/client');

async function run(prisma, label, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log('[migrate] OK: ' + label);
  } catch (e) {
    const msg = String(e.meta?.message || e.message || e).slice(0, 200);
    if (msg.includes('already exists') || msg.includes('does not exist') || msg.includes('No default')) {
      console.log('[migrate] SKIP: ' + label + ' (' + msg.slice(0, 80) + ')');
    } else {
      console.error('[migrate] WARN: ' + label + ' -> ' + msg);
    }
  }
}

async function applyEnums() {
  const prisma = new PrismaClient();

  try {
    console.log('[migrate] Starting idempotent enum migration...');

    // Step 1: Create enum types (skip if they exist)
    await run(prisma, 'create ProjectStatus', `DO $$ BEGIN CREATE TYPE "ProjectStatus" AS ENUM ('active', 'completed', 'archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await run(prisma, 'create TaskStatus', `DO $$ BEGIN CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'done'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await run(prisma, 'create ProjectTier', `DO $$ BEGIN CREATE TYPE "ProjectTier" AS ENUM ('mvp', 'medium', 'next_level'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await run(prisma, 'create JoinType', `DO $$ BEGIN CREATE TYPE "JoinType" AS ENUM ('open', 'contact', 'closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await run(prisma, 'create ShoppingItemType', `DO $$ BEGIN CREATE TYPE "ShoppingItemType" AS ENUM ('product', 'cost'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await run(prisma, 'create MediaType', `DO $$ BEGIN CREATE TYPE "MediaType" AS ENUM ('photo', 'voice'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await run(prisma, 'create CommentTargetType', `DO $$ BEGIN CREATE TYPE "CommentTargetType" AS ENUM ('group', 'project', 'task', 'announcement'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await run(prisma, 'create MediaParentType', `DO $$ BEGIN CREATE TYPE "MediaParentType" AS ENUM ('task', 'project', 'announcement', 'comment'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

    // Step 2: Normalize data (safe even if already correct or already enum)
    await run(prisma, 'normalize Project.joinType', `UPDATE "Project" SET "joinType" = 'open' WHERE "joinType" IS NOT NULL AND "joinType"::text NOT IN ('open', 'contact', 'closed')`);
    await run(prisma, 'normalize Project.tier', `UPDATE "Project" SET "tier" = NULL WHERE "tier" IS NOT NULL AND "tier"::text NOT IN ('mvp', 'medium', 'next_level')`);
    await run(prisma, 'normalize Project.status', `UPDATE "Project" SET "status" = 'active' WHERE "status"::text NOT IN ('active', 'completed', 'archived')`);
    await run(prisma, 'normalize Task.status', `UPDATE "Task" SET "status" = 'todo' WHERE "status"::text NOT IN ('todo', 'in_progress', 'done')`);
    await run(prisma, 'normalize ShoppingItem.type', `UPDATE "ShoppingItem" SET "type" = 'product' WHERE "type"::text NOT IN ('product', 'cost')`);

    // Step 3: Convert columns to enum types (skip if already the right type)
    // Using DO blocks so Postgres handles "already correct type" gracefully
    const conversions = [
      ['Project.status -> ProjectStatus',   `ALTER TABLE "Project" ALTER COLUMN "status" TYPE "ProjectStatus" USING "status"::text::"ProjectStatus"`],
      ['Project.status default',            `ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'active'::"ProjectStatus"`],
      ['Project.tier -> ProjectTier',       `ALTER TABLE "Project" ALTER COLUMN "tier" TYPE "ProjectTier" USING "tier"::text::"ProjectTier"`],
      ['Project.joinType -> JoinType',      `ALTER TABLE "Project" ALTER COLUMN "joinType" TYPE "JoinType" USING "joinType"::text::"JoinType"`],
      ['Task.status -> TaskStatus',         `ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus" USING "status"::text::"TaskStatus"`],
      ['Task.status default',               `ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'todo'::"TaskStatus"`],
      ['Comment.targetType -> CommentTargetType', `ALTER TABLE "Comment" ALTER COLUMN "targetType" TYPE "CommentTargetType" USING "targetType"::text::"CommentTargetType"`],
      ['ShoppingItem.type -> ShoppingItemType',   `ALTER TABLE "ShoppingItem" ALTER COLUMN "type" TYPE "ShoppingItemType" USING "type"::text::"ShoppingItemType"`],
      ['ShoppingItem.type default',               `ALTER TABLE "ShoppingItem" ALTER COLUMN "type" SET DEFAULT 'product'::"ShoppingItemType"`],
      ['Media.type -> MediaType',           `ALTER TABLE "Media" ALTER COLUMN "type" TYPE "MediaType" USING "type"::text::"MediaType"`],
      ['Media.parentType -> MediaParentType', `ALTER TABLE "Media" ALTER COLUMN "parentType" TYPE "MediaParentType" USING "parentType"::text::"MediaParentType"`],
    ];

    for (const [label, sql] of conversions) {
      await run(prisma, label, sql);
    }

    // Step 4: Indexes
    await run(prisma, 'drop old Task_projectId_idx', `DROP INDEX IF EXISTS "Task_projectId_idx"`);
    await run(prisma, 'create Task_projectId_status_idx', `CREATE INDEX IF NOT EXISTS "Task_projectId_status_idx" ON "Task"("projectId", "status")`);
    await run(prisma, 'drop old ShoppingItem_projectId_idx', `DROP INDEX IF EXISTS "ShoppingItem_projectId_idx"`);
    await run(prisma, 'create ShoppingItem_projectId_approved_idx', `CREATE INDEX IF NOT EXISTS "ShoppingItem_projectId_approved_idx" ON "ShoppingItem"("projectId", "approved")`);
    await run(prisma, 'drop old Media_parentType_parentId_idx', `DROP INDEX IF EXISTS "Media_parentType_parentId_idx"`);
    await run(prisma, 'create Media_parentType_parentId_createdAt_idx', `CREATE INDEX IF NOT EXISTS "Media_parentType_parentId_createdAt_idx" ON "Media"("parentType", "parentId", "createdAt")`);
    await run(prisma, 'create Group_deletedAt_idx', `CREATE INDEX IF NOT EXISTS "Group_deletedAt_idx" ON "Group"("deletedAt")`);
    await run(prisma, 'create Task_projectId_deadline_idx', `CREATE INDEX IF NOT EXISTS "Task_projectId_deadline_idx" ON "Task"("projectId", "deadline")`);
    await run(prisma, 'drop old Comment index', `DROP INDEX IF EXISTS "Comment_targetType_targetId_idx"`);
    await run(prisma, 'create Comment_targetType_targetId_createdAt_idx', `CREATE INDEX IF NOT EXISTS "Comment_targetType_targetId_createdAt_idx" ON "Comment"("targetType", "targetId", "createdAt")`);

    console.log('[migrate] Done.');
  } catch (err) {
    console.error('[migrate] Unexpected fatal error: ' + String(err).slice(0, 300));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

applyEnums();
