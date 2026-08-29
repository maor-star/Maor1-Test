import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db, departments, people, tasks } from '@/lib/db';
import type { ClickUpAdapter, ClickUpTask } from '@/lib/integrations/types';
import { recordFailure, recordSuccess } from '@/lib/integrations/health';
import { computeHeat } from '@/lib/tasks/heat';
import { deptForList } from './departments';
import { toMirrorRow, type MirrorRow } from './clickup-map';

/**
 * Spec 6.1.2 — the company layer mirrors ClickUp. Read-only: the mirror never
 * writes back, and a `layer = 'company'` row is rejected by the task editor.
 *
 * The mirror holds open work only. A finished task is removed from the cockpit
 * rather than kept as a done row, because the cockpit's job is to show what is
 * still waiting — a list that also carries a year of completed work answers a
 * different question. ClickUp keeps the history; this is a working surface.
 *
 * Deletion here is the one place the "archive, never delete" rule (CLAUDE.md
 * §2) does not apply: a mirror row is a cached copy, not a record. The task
 * itself is untouched in ClickUp, and re-syncing rebuilds any row.
 */

export interface SyncResult {
  fetched: number;
  upserted: number;
  /** Finished tasks removed from the mirror. */
  removed: number;
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
    return { fetched: 0, upserted: 0, removed: 0, skipped: 0, error: message };
  }

  const rows = fetched.map(toMirrorRow);
  const open = rows.filter((r) => !r.finished);
  const finished = rows.filter((r) => r.finished);

  const [ownerByEmail, deptIdByCode] = await Promise.all([
    loadOwners(open),
    loadDepartments(),
  ]);

  let upserted = 0;
  for (const row of open) {
    await upsert(row, ownerByEmail, deptIdByCode, now);
    upserted += 1;
  }

  // Anything that finished since the last sync leaves the mirror.
  const removed = await removeFinished(finished.map((r) => r.clickupId));

  await recordSuccess('clickup');
  return { fetched: fetched.length, upserted, removed, skipped: fetched.length - rows.length };
}

/** Applies a single webhook payload without waiting for the next poll. */
export async function syncSingleTask(
  adapter: ClickUpAdapter,
  clickupTaskId: string,
  now = new Date(),
): Promise<'upserted' | 'removed' | 'not_found'> {
  const task = await adapter.getTask(clickupTaskId);
  if (!task) return 'not_found';

  const row = toMirrorRow(task);
  if (row.finished) {
    await removeFinished([row.clickupId]);
    return 'removed';
  }

  const [ownerByEmail, deptIdByCode] = await Promise.all([loadOwners([row]), loadDepartments()]);
  await upsert(row, ownerByEmail, deptIdByCode, now);
  return 'upserted';
}

/**
 * Drops every mirrored task ClickUp no longer counts as open. Used both by the
 * delta sync and by the one-off cleanup that runs when the token is first
 * connected, to clear tasks that finished before the mirror existed.
 */
export async function removeFinished(clickupIds: string[]): Promise<number> {
  if (clickupIds.length === 0) return 0;
  const deleted = await db
    .delete(tasks)
    .where(and(eq(tasks.layer, 'company'), inArray(tasks.clickupId, clickupIds)))
    .returning({ id: tasks.id });
  return deleted.length;
}

/**
 * Clears mirrored tasks whose status is already done — the tasks the CEO asked
 * not to carry. Safe to run repeatedly.
 */
export async function purgeFinishedMirror(): Promise<number> {
  const deleted = await db
    .delete(tasks)
    .where(and(eq(tasks.layer, 'company'), isNotNull(tasks.clickupId), eq(tasks.status, 'done')))
    .returning({ id: tasks.id });
  return deleted.length;
}

async function loadOwners(rows: MirrorRow[]): Promise<Map<string, string>> {
  const emails = [...new Set(rows.map((r) => r.ownerEmail).filter((e): e is string => !!e))];
  if (emails.length === 0) return new Map();
  const owners = await db
    .select({ id: people.id, email: people.email })
    .from(people)
    .where(inArray(people.email, emails));
  return new Map(owners.map((o) => [o.email.toLowerCase(), o.id]));
}

async function loadDepartments(): Promise<Map<string, string>> {
  const rows = await db.select({ id: departments.id, code: departments.code }).from(departments);
  return new Map(rows.map((d) => [d.code, d.id]));
}

async function upsert(
  row: MirrorRow,
  ownerByEmail: Map<string, string>,
  deptIdByCode: Map<string, string>,
  now: Date,
): Promise<void> {
  const ownerPersonId = row.ownerEmail
    ? (ownerByEmail.get(row.ownerEmail.toLowerCase()) ?? null)
    : null;
  const deptCode = deptForList(row.listId, row.listName);
  const deptId = deptCode ? (deptIdByCode.get(deptCode) ?? null) : null;

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
    deptId,
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

  await db.insert(tasks).values(values).onConflictDoUpdate({ target: tasks.clickupId, set: values });
}
