import { and, eq, inArray, isNotNull, lt, ne } from 'drizzle-orm';
import { db, departments, people, tasks } from '@/lib/db';
import type { ClickUpAdapter, ClickUpTask } from '@/lib/integrations/types';
import { recordFailure, recordSuccess } from '@/lib/integrations/health';
import { computeHeat } from '@/lib/tasks/heat';
import { deptForList } from './departments';
import { toMirrorRow, type MirrorRow } from './clickup-map';
import { shouldMirror } from './mirror-skip';

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
  /** Tasks that belong to somebody else, and were never mirrored. */
  theirs?: number;
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

  /*
   * The pair's own work never enters the mirror. See lib/sync/mirror-skip.ts
   * for why this is only ever the pair, and never one of them alone.
   *
   * Filtering on the way in rather than on the way out matters: a row that
   * exists shows up in a count, a search, and the next screen somebody builds
   * against this table.
   */
  const all = fetched.map(toMirrorRow);
  const rows = all.filter((r) => shouldMirror(r.assigneeEmails));
  const theirs = all.length - rows.length;

  const open = rows.filter((r) => !r.finished);
  const finished = rows.filter((r) => r.finished);

  // Anything already mirrored that is now somebody else's — the list changed,
  // or a task was reassigned — goes, so the rule applies to what is here too.
  const notHis = all.filter((r) => !shouldMirror(r.assigneeEmails)).map((r) => r.clickupId);
  const dropped = await dropNotHis(notHis);

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
  return {
    fetched: fetched.length,
    upserted,
    removed: removed + dropped,
    // Fetched, but not upserted: somebody else's, or already finished.
    skipped: fetched.length - upserted,
    theirs,
  };
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
  if (!shouldMirror(row.assigneeEmails)) {
    await dropNotHis([row.clickupId]);
    return 'removed';
  }
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
/**
 * Clears mirrored tasks that turn out to be somebody else's.
 *
 * These are dropped rather than marked done: they are not finished work, they
 * are work that was never his. Nothing is lost — the row is a copy of a
 * ClickUp task that still exists there.
 */
export async function dropNotHis(clickupIds: string[]): Promise<number> {
  if (clickupIds.length === 0) return 0;
  const gone = await db
    .delete(tasks)
    .where(and(eq(tasks.layer, 'company'), inArray(tasks.clickupId, clickupIds)))
    .returning({ id: tasks.id });
  return gone.length;
}

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
 * It used to be three — the department, the tags and the owner — on the
 * reasoning that everything else was ClickUp's and had to be rewritten on
 * every poll, because the team's edits must not be reverted by a stale copy
 * here.
 *
 * That held while he worked in ClickUp too. He does not: "I don't have to
 * update ClickUp because I don't update there any more." So an edit he makes
 * here is his, and the poll must leave it alone — otherwise a title or a
 * status ClickUp would not take gets quietly rolled back five minutes later,
 * which is the whole failure this is meant to end.
 *
 * A field is pinned only once he actually sets it, so everything he has not
 * touched still follows ClickUp and the team's work still arrives. And a task
 * ClickUp CLOSES is still marked done regardless — that happens in
 * removeFinished, not here, because the team finishing something is news
 * rather than a revert.
 */
export const PINNABLE = [
  'title', 'description', 'priority', 'status', 'dueDate', 'startDate',
  'deptId', 'tags', 'ownerPersonId',
] as const;
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
    .select()
    .from(tasks)
    .where(eq(tasks.clickupId, row.clickupId))
    .limit(1);

  /*
   * A pinned field simply does not take part in the update.
   *
   * Dropping it from the SET is the whole mechanism, and it is done by name
   * rather than field by field so that pinning a new column later needs no
   * second edit here — the previous version honoured exactly three names and
   * silently ignored anything else that was pinned.
   */
  const pinned = new Set<string>(existing?.pinnedFields ?? []);
  const update: Record<string, unknown> = { ...values };
  for (const field of PINNABLE) {
    if (pinned.has(field)) delete update[field];
  }

  // Heat reads the priority and the owner, so it follows whichever of those
  // survived rather than ClickUp's copy of both.
  if (pinned.has('ownerPersonId') || pinned.has('priority') || pinned.has('dueDate')) {
    update.heatScore = computeHeat(
      {
        priority: (pinned.has('priority') ? existing?.priority : row.priority) ?? row.priority,
        dueDate: (pinned.has('dueDate') ? existing?.dueDate : row.dueDate) ?? null,
        moneyImpactCents: null,
        blockedPeople: [],
        ownerPersonId:
          (pinned.has('ownerPersonId') ? existing?.ownerPersonId : ownerPersonId) ?? null,
      },
      now,
    );
  }

  await db
    .insert(tasks)
    .values(values)
    .onConflictDoUpdate({ target: tasks.clickupId, set: update });
}
