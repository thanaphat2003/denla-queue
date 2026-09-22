import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

const backendRoot = resolve(__dirname, '..');
dotenv.config({ path: resolve(backendRoot, '.env') });

const configuredDatabaseUrl = process.env.DATABASE_URL;
if (!configuredDatabaseUrl) {
  const dbPath = resolve(backendRoot, 'prisma/data/school_queue.db');
  process.env.DATABASE_URL = `file:${dbPath}`;
} else if (configuredDatabaseUrl === 'file:./prisma/data/school_queue.db') {
  const dbPath = resolve(backendRoot, 'prisma/data/school_queue.db');
  process.env.DATABASE_URL = `file:${dbPath}`;
}

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export { prisma };
