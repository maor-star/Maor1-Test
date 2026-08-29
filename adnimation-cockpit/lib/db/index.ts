import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
}

// Next.js hot-reloads modules in dev; keep one pool per process.
const globalForDb = globalThis as unknown as { __cockpitSql?: ReturnType<typeof postgres> };

const client =
  globalForDb.__cockpitSql ??
  postgres(connectionString, {
    max: 10,
    // Every timestamp round-trips as UTC; rendering to Asia/Jerusalem is a UI concern.
    types: {},
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== 'production') globalForDb.__cockpitSql = client;

export const db = drizzle(client, { schema });
export { schema };
export * from './schema';
