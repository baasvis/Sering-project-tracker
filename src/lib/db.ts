import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const dbUrl = process.env.DATABASE_URL || '';
const pooledUrl = dbUrl.includes('connection_limit')
  ? dbUrl
  : `${dbUrl}${dbUrl.includes('?') ? '&' : '?'}connection_limit=50`;

// Base client with query timeout built into the connection string
// Prisma 6+ uses statement_timeout at the DB level for per-query timeouts
const timeoutUrl = pooledUrl.includes('statement_timeout')
  ? pooledUrl
  : `${pooledUrl}&statement_timeout=10000`; // 10s query timeout

const prisma = new PrismaClient({
  datasources: { db: { url: timeoutUrl } },
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
});

// Note: Prisma disconnect is handled by server.ts gracefulShutdown()
// to ensure it runs after server.close() completes

// Typed delegate lookup — eliminates (prisma as any)[model] casts
const prismaModelMap = {
  group: prisma.group,
  project: prisma.project,
  task: prisma.task,
  announcement: prisma.announcement,
  comment: prisma.comment,
  shoppingItem: prisma.shoppingItem,
  media: prisma.media,
  toolItem: prisma.toolItem,
  report: prisma.report,
  auditLog: prisma.auditLog,
  getTogetherLocation: prisma.getTogetherLocation,
  getTogetherBlock: prisma.getTogetherBlock,
  getTogetherSignup: prisma.getTogetherSignup,
} as const;

export type PrismaModelName = keyof typeof prismaModelMap;

export function getPrismaDelegate(name: PrismaModelName) {
  return prismaModelMap[name];
}

// Transaction client type — use for typed $transaction callbacks
export type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export default prisma;
