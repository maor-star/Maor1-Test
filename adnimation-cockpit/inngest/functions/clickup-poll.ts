import { db, integrationHealth } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { inngest } from '../client';
import { createClickUpAdapter } from '@/lib/integrations/clickup';
import { syncClickUpTasks } from '@/lib/sync/clickup-mirror';

/** Overlap window so a task updated during the previous run is not missed. */
const POLL_OVERLAP_MS = 60_000;
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Spec 6.1.2 — delta poll every five minutes, alongside the webhook. The
 * webhook is the fast path; this is the safety net for the ones it drops.
 */
export const clickUpPoll = inngest.createFunction(
  { id: 'clickup-delta-poll', retries: 3 },
  { cron: '*/5 * * * *' },
  async ({ step }) => {
    const since = await step.run('read-watermark', async () => {
      const [health] = await db
        .select()
        .from(integrationHealth)
        .where(eq(integrationHealth.system, 'clickup'))
        .limit(1);
      const last = health?.lastSuccessAt?.getTime();
      return last ? last - POLL_OVERLAP_MS : Date.now() - FIRST_RUN_LOOKBACK_MS;
    });

    return step.run('sync', () => syncClickUpTasks(createClickUpAdapter(), since));
  },
);
