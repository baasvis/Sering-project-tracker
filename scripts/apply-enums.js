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
    console.log('[migrate] DATABASE_URL set: ' + (!!process.env.DATABASE_URL));

    // Check if the Project.status column is already an enum (not just text)
    console.log('[migrate] Querying column info...');
    const colCheck = await prisma.$queryRaw`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = 'Project' AND column_name = 'status'
    `;

    const currentType = colCheck[0]?.udt_name || 'unknown';
    console.log('[migrate] Project.status column type:', currentType);

    if (currentType === 'ProjectStatus') {
      console.log('[migrate] Columns already converted to enums, skipping.');

      // Still ensure indexes exist
      await applyIndexes(prisma);
      return;
    }

    console.log('[migrate] Converting columns to enums...');

    // Create enum types (IF NOT EXISTS via catch)
    const enumDefs = [
      `CREATE TYPE "ProjectStatus" AS ENUM ('active', 'completed', 'archived')`,
      `CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'done')`,
      `CREATE TYPE "ProjectTier" AS ENUM ('mvp', 'medium', 'next_level')`,
      `CREATE TYPE "JoinType" AS ENUM ('open', 'contact', 'closed')`,
      `CREATE TYPE "ShoppingItemType" AS ENUM ('product', 'cost')`,
      `CREATE TYPE "MediaType" AS ENUM ('photo', 'voice')`,
      `CREATE TYPE "CommentTargetType" AS ENUM ('group', 'project', 'task', 'announcement')`,
      `CREATE TYPE "MediaParentType" AS ENUM ('task', 'project', 'announcement', 'comment')`,
    ];

    for (const sql of enumDefs) {
      try {
        await prisma.$executeRawUnsafe(sql);
      } catch (e) {
        // Type already exists — that's fine
        if (e.message && e.message.includes('already exists')) {
          console.log('[migrate] (type already exists, continuing)');
        } else {
          throw e;
        }
      }
    }
    console.log('[migrate] Enum types ready.');

    // Normalize invalid data before casting
    await prisma.$executeRawUnsafe(`UPDATE "Project" SET "joinType" = 'open' WHERE "joinType" NOT IN ('open', 'contact', 'closed') AND "joinType" IS NOT NULL`);
    await prisma.$executeRawUnsafe(`UPDATE "Project" SET "tier" = NULL WHERE "tier" NOT IN ('mvp', 'medium', 'next_level') AND "tier" IS NOT NULL`);
    await prisma.$executeRawUnsafe(`UPDATE "Project" SET "status" = 'active' WHERE "status" NOT IN ('active', 'completed', 'archived')`);
    await prisma.$executeRawUnsafe(`UPDATE "Task" SET "status" = 'todo' WHERE "status" NOT IN ('todo', 'in_progress', 'done')`);
    await prisma.$executeRawUnsafe(`UPDATE "ShoppingItem" SET "type" = 'product' WHERE "type" NOT IN ('product', 'cost')`);
    console.log('[migrate] Data normalized.');

    // Convert columns — each wrapped individually so we can skip already-converted ones
    const conversions = [
      { table: 'Project', column: 'status', type: 'ProjectStatus', default: 'active' },
      { table: 'Project', column: 'tier', type: 'ProjectTier', default: null },
      { table: 'Project', column: 'joinType', type: 'JoinType', default: null },
      { table: 'Task', column: 'status', type: 'TaskStatus', default: 'todo' },
      { table: 'Comment', column: 'targetType', type: 'CommentTargetType', default: null },
      { table: 'ShoppingItem', column: 'type', type: 'ShoppingItemType', default: 'product' },
      { table: 'Media', column: 'type', type: 'MediaType', default: null },
      { table: 'Media', column: 'parentType', type: 'MediaParentType', default: null },
    ];

    for (const c of conversions) {
      // Check if this column is already the right type
      const check = await prisma.$queryRaw`
        SELECT udt_name FROM information_schema.columns
        WHERE table_name = ${c.table} AND column_name = ${c.column}
      `;
      if (check[0]?.udt_name === c.type) {
        console.log(`[migrate] ${c.table}.${c.column} already ${c.type}, skipping.`);
        continue;
      }

      console.log(`[migrate] Converting ${c.table}.${c.column} to ${c.type}...`);
      if (c.default) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "${c.table}" ALTER COLUMN "${c.column}" SET DEFAULT '${c.default}'`);
      } else {
        try { await prisma.$executeRawUnsafe(`ALTER TABLE "${c.table}" ALTER COLUMN "${c.column}" DROP DEFAULT`); } catch { /* no default to drop */ }
      }
      await prisma.$executeRawUnsafe(`ALTER TABLE "${c.table}" ALTER COLUMN "${c.column}" TYPE "${c.type}" USING "${c.column}"::"${c.type}"`);
      if (c.default) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "${c.table}" ALTER COLUMN "${c.column}" SET DEFAULT '${c.default}'`);
      }
    }
    console.log('[migrate] All columns converted.');

    await applyIndexes(prisma);

    console.log('[migrate] Enum migration complete!');
  } catch (err) {
    console.error('[migrate] Migration failed.');
    console.error('[migrate] Error name: ' + (err.name || 'unknown'));
    console.error('[migrate] Error code: ' + (err.code || 'none'));
    // Prisma wraps the real error — dig it out
    const cause = err.cause || err;
    console.error('[migrate] Cause: ' + String(cause));
    console.error('[migrate] Stack: ' + (err.stack || 'no stack').slice(0, 500));
    // Try to get Prisma's internal message
    if (err.meta) console.error('[migrate] Meta: ' + JSON.stringify(err.meta));
    // Log the entire error as a string
    try { console.error('[migrate] Stringified: ' + JSON.stringify(err)); } catch { /* circular */ }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function applyIndexes(prisma) {
  console.log('[migrate] Ensuring indexes...');
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Task_projectId_idx"`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Task_projectId_status_idx" ON "Task"("projectId", "status")`);
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "ShoppingItem_projectId_idx"`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ShoppingItem_projectId_approved_idx" ON "ShoppingItem"("projectId", "approved")`);
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Media_parentType_parentId_idx"`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Media_parentType_parentId_createdAt_idx" ON "Media"("parentType", "parentId", "createdAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Group_deletedAt_idx" ON "Group"("deletedAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Task_projectId_deadline_idx" ON "Task"("projectId", "deadline")`);
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Comment_targetType_targetId_idx"`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Comment_targetType_targetId_createdAt_idx" ON "Comment"("targetType", "targetId", "createdAt")`);
  console.log('[migrate] Indexes ready.');
}

applyEnums();
