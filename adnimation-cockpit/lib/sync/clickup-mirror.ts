import { and, eq, inArray, isNotNull, lt, ne } from 'drizzle-orm';
import { db, departments, people, tasks } from '@/lib/db';
import type { ClickUpAdapter, ClickUpTask } from '@/lib/integrations/types';
import { recordFailure, recordSuccess } from '@/lib/integrations/health';
import { computeHeat } from '@/lib/tasks/heat';
import { deptForList } from './departments';
import { toMirrorRow, type MirrorRow } from './clickup-map';

/**
 * Spec 6.1.2 — the company layer mirrors ClickUp, which stays the system of
 * record: every poll rewrites a task's fields from ClickUp, and an edit made
 * here is written to ClickUp first and mirrored only once it is accepted.
 *
 * Two exceptions, both because ClickUp has nowhere to keep them: the fields
 * he has taken over (see PINNABLE) survive a poll, and a task detached from
 * ClickUp stops being mirrored at all.
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
 * Marks every mirrored task ClickUp no longer counts as open as done.
 *
 * It used to delete them. That made the list right and reopening impossible:
 * a task closed by mistake was simply gone from the cockpit, with no row to
 * put back. Nothing in this system deletes (CLAUDE.md §2), and the default
 * list already hides done, so keeping the row costs nothing on screen and
 * gives him the undo. purgeFinishedMirror clears the old ones.
 */
export async function removeFinished(clickupIds: string[], now = new Date()): Promise<number> {
  if (clickupIds.length === 0) return 0;
  const closed = await db
    .update(tasks)
    .set({ status: 'done', updatedAt: now, lastSyncedAt: now })
    .where(
      and(
        eq(tasks.layer, 'company'),
        inArray(tasks.clickupId, clickupIds),
        ne(tasks.status, 'done'),
      ),
    )
    .returning({ id: tasks.id });
  return closed.length;
}

/** How long a finished ClickUp task stays reopenable from the cockpit. */
export const KEEP_FINISHED_DAYS = 30;

/**
 * Clears mirrored tasks that finished long enough ago that nobody is going to
 * reopen them. Safe to run repeatedly.
 *
 * Recent ones stay: the whole reason they are kept is the task closed by
 * mistake, and that is noticed within a day or two, not a month.
 */
export async function purgeFinishedMirror(olderThanDays = KEEP_FINISHED_DAYS): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 3600_000);
  const deleted = await db
    .delete(tasks)
    .where(
      and(
        eq(tasks.layer, 'company'),
        isNotNull(tasks.clickupId),
        eq(tasks.status, 'done'),
        lt(tasks.updatedAt, cutoff),
      ),
    )
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

/**
 * The fields the cockpit may take over on a mirrored task.
 *
 * Everything else on the row is ClickUp's and is rewritten on every poll —
 * which is right: the team's edits must not be silently reverted by a stale
 * copy here.
 */
export const PINNABLE = ['deptId', 'tags', 'ownerPersonId'] as const;
export type Pinnable = (typeof PINNABLE)[number];

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

  /*
   * What he has taken over stays his.
   *
   * A department he filed the task under, or a tag he added, exists nowhere in
   * ClickUp — so writing ClickUp's version of those back over his would clear
   * them five minutes after he set them, with nothing to show what happened.
   */
  const [existing] = await db
    .select({ pinned: tasks.pinnedFields, deptId: tasks.deptId, tags: tasks.tags, ownerPersonId: tasks.ownerPersonId })
    .from(tasks)
    .where(eq(tasks.clickupId, row.clickupId))
    .limit(1);

  const pinned = new Set(existing?.pinned ?? []);
  const update = { ...values };
  if (pinned.has('deptId')) update.deptId = existing?.deptId ?? null;
  if (pinned.has('tags')) update.tags = existing?.tags ?? [];
  if (pinned.has('ownerPersonId')) {
    update.ownerPersonId = existing?.ownerPersonId ?? null;
    // Heat depends on whether a task is owned, so it follows the owner he set.
    update.heatScore = computeHeat(
      {
        priority: row.priority,
        dueDate: row.dueDate,
        moneyImpactCents: null,
        blockedPeople: [],
        ownerPersonId: update.ownerPersonId,
      },
      now,
    );
  }

  await db
    .insert(tasks)
    .values(values)
    .onConflictDoUpdate({ target: tasks.clickupId, set: update });
}
