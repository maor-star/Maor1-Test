import { and, eq, isNull } from 'drizzle-orm';
import { alerts, db, people, tasks, users } from '@/lib/db';
import { inngest } from '../client';
import { evaluateHygiene, type HygieneViolation } from '@/lib/tasks/hygiene';
import { recomputeAllHeat } from '@/lib/tasks/mutations';

const SEVERITY_TO_ALERT = {
  info: 'info', watch: 'watch', warning: 'warning', critical: 'critical',
} as const;

/**
 * Spec 6.3 — the hygiene rules run once a day, before the morning brief, and
 * raise one alert per violation. The group key keeps a rule that keeps failing
 * on the same task from filling the inbox (spec 11.4).
 */
export const taskHygiene = inngest.createFunction(
  { id: 'task-hygiene', retries: 2 },
  { cron: '0 4 * * *' }, // 07:00 Asia/Jerusalem in summer; the brief goes out at 07:30.
  async ({ step }) => {
    await step.run('recompute-heat', () => recomputeAllHeat());

    const violations = await step.run('evaluate', async () => {
      const [owner] = await db.select().from(users).where(eq(users.role, 'owner')).limit(1);
      const ceoPerson = owner
        ? await db.select({ id: people.id }).from(people).where(eq(people.email, owner.email)).limit(1)
        : [];
      const ceoPersonId = ceoPerson[0]?.id ?? null;

      const open = await db
        .select()
        .from(tasks)
        .where(and(isNull(tasks.archivedAt), eq(tasks.layer, 'mine')));

      return open.flatMap((t) =>
        evaluateHygiene({
          id: t.id,
          title: t.title,
          priority: t.priority,
          status: t.status,
          dueDate: t.dueDate,
          ownerPersonId: t.ownerPersonId,
          ownerIsCeo: ceoPersonId !== null && t.ownerPersonId === ceoPersonId,
          snoozeCount: t.snoozeCount,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }),
      );
    });

    await step.run('raise-alerts', async () => {
      for (const v of violations as HygieneViolation[]) {
        // One open alert per (task, rule): re-raising daily would drown the inbox.
        const groupKey = `hygiene:${v.code}:${v.taskId}`;
        const existing = await db
          .select({ id: alerts.id })
          .from(alerts)
          .where(and(eq(alerts.groupKey, groupKey), isNull(alerts.ackedAt)))
          .limit(1);
        if (existing.length > 0) continue;

        await db.insert(alerts).values({
          type: 'TASK_OVERDUE',
          severity: SEVERITY_TO_ALERT[v.severity],
          entityType: 'task',
          entityId: v.taskId,
          groupKey,
          title: v.title,
          body: v.whatHappened,
          whatHappened: v.whatHappened,
          occurredAt: new Date(),
          recommendedAction: v.recommendedAction,
          createdBy: 'agent:task-hygiene',
        });
      }
      return { raised: violations.length };
    });

    return { violations: violations.length };
  },
);
