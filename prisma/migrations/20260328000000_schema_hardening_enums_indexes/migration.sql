-- Phase 1: Schema hardening — enums, constraints, indexes
-- Converts string columns to PostgreSQL enums and adds missing indexes.
-- Existing data is migrated in-place via ALTER COLUMN ... USING.

-- ─── Create enum types ──────────────────────────────────────────────────────

CREATE TYPE "ProjectStatus" AS ENUM ('active', 'completed', 'archived');
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'done');
CREATE TYPE "ProjectTier" AS ENUM ('mvp', 'medium', 'next_level');
CREATE TYPE "JoinType" AS ENUM ('open', 'contact', 'closed');
CREATE TYPE "ShoppingItemType" AS ENUM ('product', 'cost');
CREATE TYPE "MediaType" AS ENUM ('photo', 'voice');
CREATE TYPE "CommentTargetType" AS ENUM ('group', 'project', 'task', 'announcement');
CREATE TYPE "MediaParentType" AS ENUM ('task', 'project', 'announcement', 'comment');

-- ─── Fix invalid data before converting ─────────────────────────────────────

-- Seed data had non-standard joinType values; normalize them before cast
UPDATE "Project" SET "joinType" = 'open' WHERE "joinType" NOT IN ('open', 'contact', 'closed') AND "joinType" IS NOT NULL;
UPDATE "Project" SET "tier" = NULL WHERE "tier" NOT IN ('mvp', 'medium', 'next_level') AND "tier" IS NOT NULL;

-- ─── Convert columns to enum types ──────────────────────────────────────────

-- Project
ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'active';
ALTER TABLE "Project" ALTER COLUMN "status" TYPE "ProjectStatus" USING "status"::"ProjectStatus";
ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'active';

ALTER TABLE "Project" ALTER COLUMN "tier" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "tier" TYPE "ProjectTier" USING "tier"::"ProjectTier";

ALTER TABLE "Project" ALTER COLUMN "joinType" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "joinType" TYPE "JoinType" USING "joinType"::"JoinType";

-- Task
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'todo';
ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus" USING "status"::"TaskStatus";
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'todo';

-- Comment
ALTER TABLE "Comment" ALTER COLUMN "targetType" TYPE "CommentTargetType" USING "targetType"::"CommentTargetType";

-- ShoppingItem
ALTER TABLE "ShoppingItem" ALTER COLUMN "type" SET DEFAULT 'product';
ALTER TABLE "ShoppingItem" ALTER COLUMN "type" TYPE "ShoppingItemType" USING "type"::"ShoppingItemType";
ALTER TABLE "ShoppingItem" ALTER COLUMN "type" SET DEFAULT 'product';

-- Media
ALTER TABLE "Media" ALTER COLUMN "type" TYPE "MediaType" USING "type"::"MediaType";
ALTER TABLE "Media" ALTER COLUMN "parentType" TYPE "MediaParentType" USING "parentType"::"MediaParentType";

-- ─── Add missing indexes ────────────────────────────────────────────────────

-- Task: compound index on projectId + status (replaces projectId-only index)
DROP INDEX IF EXISTS "Task_projectId_idx";
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- ShoppingItem: compound index on projectId + approved (replaces projectId-only index)
DROP INDEX IF EXISTS "ShoppingItem_projectId_idx";
CREATE INDEX "ShoppingItem_projectId_approved_idx" ON "ShoppingItem"("projectId", "approved");

-- Media: compound index on parentType + parentId + createdAt (replaces parentType+parentId index)
DROP INDEX IF EXISTS "Media_parentType_parentId_idx";
CREATE INDEX "Media_parentType_parentId_createdAt_idx" ON "Media"("parentType", "parentId", "createdAt");
