import { sql } from 'drizzle-orm';
import { db, integrationHealth } from '@/lib/db';

export { INTEGRATION_STALE_HOURS, isStale } from './staleness';

export async function recordSuccess(system: string): Promise<void> {
  const now = new Date();
  await db
    .insert(integrationHealth)
    .values({ system, lastSuccessAt: now, lastAttemptAt: now, consecutiveErrors: 0, lastError: null })
    .onConflictDoUpdate({
      target: integrationHealth.system,
      set: { lastSuccessAt: now, lastAttemptAt: now, consecutiveErrors: 0, lastError: null },
    });
}

export async function recordFailure(system: string, error: string): Promise<void> {
  const now = new Date();
  await db
    .insert(integrationHealth)
    .values({ system, lastAttemptAt: now, consecutiveErrors: 1, lastError: error.slice(0, 2000) })
    .onConflictDoUpdate({
      target: integrationHealth.system,
      set: {
        lastAttemptAt: now,
        lastError: error.slice(0, 2000),
        consecutiveErrors: sql`${integrationHealth.consecutiveErrors} + 1`,
      },
    });
}
