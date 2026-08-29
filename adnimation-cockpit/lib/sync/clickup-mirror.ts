import { eq, inArray } from 'drizzle-orm';
import { db, people, tasks } from '@/lib/db';
import type { ClickUpAdapter, ClickUpTask } from '@/lib/integrations/types';
import { recordFailure, recordSuccess } from '@/lib/integrations/health';
import { computeHeat } from '@/lib/tasks/heat';
import { toMirrorRow } from './clickup-map';

/**
 * Spec 6.1.2 — the company layer mirrors ClickUp. Read-only: the mirror never
 * writes back, and a `layer = 'company'` row is rejected by the task editor.
 */

export interface SyncResult {
  fetched: number;
  upserted: number;
  skipped: number;
  error?: string;
}

/**
 * Delta sync. Upserts on `clickup_id`, so a redelivered webhook and the
 * five-minute poll converge on the same row instead of duplicating it.
 */
export async function syncClickUpTasks(
  adapter: ClickUpAdapter,
  sinceMs: number,
  now = new Date(),
): Promise<SyncResult> {
  let fetched: ClickUpTask[];
  try {
    fetched = await adapter.listTasksUpdatedSince(sinceMs);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown';
    await recordFailure('clickup', message);
    return { fetched: 0, upserted: 0, skipped: 0, error: message };
  }

  const rows = fetched.map(toMirrorRow);
  const emails = [...new Set(rows.map((r) => r.ownerEmail).filter((e): e is string => !!e))];
  const owners = emails.length
    ? await db
        .select({ id: people.id, email: people.email })
        .from(people)
        .where(inArray(people.email, emails))
    : [];
  const ownerByEmail = new Map(owners.map((o) => [o.email.toLowerCase(), o.id]));

  let upserted = 0;
  for (const row of rows) {
    const ownerPersonId = row.ownerEmail
      ? (ownerByEmail.get(row.ownerEmail.toLowerCase()) ?? null)
      : null;

    const values = {
      layer: 'company' as const,
      clickupId: row.clickupId,
      clickupUrl: row.clickupUrl,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dueDate: row.dueDate,
      startDate: row.startDate,
      tags: row.tags,
      ownerPersonId,
      heatScore: computeHeat(
        {
          priority: row.priority,
          dueDate: row.dueDate,
          moneyImpactCents: null,
          blockedPeople: [],
          ownerPersonId,
        },
        now,
      ),
      source: 'manual' as const,
      updatedAt: now,
      lastSyncedAt: now,
    };

    await db
      .insert(tasks)
      .values(values)
      .onConflictDoUpdate({ target: tasks.clickupId, set: values });
    upserted += 1;
  }

  await recordSuccess('clickup');
  return { fetched: fetched.length, upserted, skipped: fetched.length - rows.length };
}

/** Applies a single webhook payload without waiting for the next poll. */
export async function syncSingleTask(
  adapter: ClickUpAdapter,
  clickupTaskId: string,
  now = new Date(),
): Promise<'upserted' | 'not_found'> {
  const task = await adapter.getTask(clickupTaskId);
  if (!task) return 'not_found';
  await syncFetchedTasks([task], now);
  return 'upserted';
}

async function syncFetchedTasks(fetched: ClickUpTask[], now: Date): Promise<void> {
  for (const task of fetched) {
    const row = toMirrorRow(task);
    const [owner] = row.ownerEmail
      ? await db.select({ id: people.id }).from(people).where(eq(people.email, row.ownerEmail)).limit(1)
      : [];
    const ownerPersonId = owner?.id ?? null;
    const values = {
      layer: 'company' as const,
      clickupId: row.clickupId,
      clickupUrl: row.clickupUrl,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dueDate: row.dueDate,
      startDate: row.startDate,
      tags: row.tags,
      ownerPersonId,
      heatScore: computeHeat(
        { priority: row.priority, dueDate: row.dueDate, moneyImpactCents: null, blockedPeople: [], ownerPersonId },
        now,
      ),
      updatedAt: now,
      lastSyncedAt: now,
    };
    await db.insert(tasks).values(values).onConflictDoUpdate({ target: tasks.clickupId, set: values });
  }
}
