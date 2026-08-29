import { eq } from 'drizzle-orm';
import { alerts, db, people } from '@/lib/db';
import { inngest } from '../client';
import { markStaleDelegations } from '@/lib/delegation/service';
import { DELEGATION_STALE_DAYS } from '@/lib/tasks/types';

/**
 * Spec 6.1.3 — a delegation that has not moved for three days flips to stale
 * and the CEO gets one reminder. This is the check that stops handed-off work
 * from quietly falling on the floor.
 */
export const delegationWatch = inngest.createFunction(
  { id: 'delegation-stale-watch', retries: 2 },
  { cron: '30 4 * * *' },
  async ({ step }) => {
    const stale = await step.run('mark-stale', () => markStaleDelegations());

    await step.run('alert', async () => {
      for (const d of stale) {
        const [person] = await db
          .select({ name: people.name })
          .from(people)
          .where(eq(people.id, d.delegatedTo))
          .limit(1);
        await db.insert(alerts).values({
          type: 'TASK_OVERDUE',
          severity: 'warning',
          entityType: 'delegation',
          entityId: d.id,
          groupKey: `delegation-stale:${d.id}`,
          title: `Delegation stalled: ${person?.name ?? 'unknown'}`,
          body: d.note ?? '',
          whatHappened: `No movement for ${DELEGATION_STALE_DAYS} days.`,
          occurredAt: new Date(),
          ownerPersonId: d.delegatedTo,
          recommendedAction: 'Check with the owner or pull the task back.',
          createdBy: 'agent:delegation-watch',
        });
      }
      return { alerted: stale.length };
    });

    return { stale: stale.length };
  },
);
