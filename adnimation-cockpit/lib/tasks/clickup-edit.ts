import { and, eq, isNotNull } from 'drizzle-orm';
import { db, tasks } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { PRIORITY_TO_CLICKUP, createClickUpAdapter } from '@/lib/integrations/clickup';
import { mapClickUpStatus } from '@/lib/sync/clickup-map';
import type { ClickUpAdapter, ClickUpTaskPatch } from '@/lib/integrations/types';
import type { TaskPriority } from './types';

/**
 * Editing a task that came from ClickUp.
 *
 * This used to write to ClickUp FIRST and keep the edit here only once ClickUp
 * accepted it, on the reasoning that ClickUp was the system of record and a
 * cockpit showing an edit the team never saw was the worse failure.
 *
 * That reasoning is spent. "I don't have to update ClickUp because I don't
 * update there any more" — the cockpit is where he works, so an edit of his
 * failing because a ClickUp list does not have a matching word, or because a
 * token lapsed, is a task that did not move for a reason that is no longer
 * about his business. So the order is now the other way round:
 *
 * · The edit is written here, always. It is his system and his edit.
 * · ClickUp is TOLD, best effort. If it takes the change the team sees it; if
 *   it refuses, that is reported back for the screen to mention and nothing
 *   here is undone.
 * · Every field he sets is pinned, so the next poll cannot quietly revert it.
 *   That is what makes the first rule true five minutes later: without it, a
 *   push that failed would be silently rolled back by the sync.
 *
 * One thing the poll still wins: a task ClickUp has CLOSED is marked done here
 * regardless of pinning, because that happens outside this upsert path (see
 * removeFinished). The team closing something is news, not a revert.
 */
export interface MirroredTaskPatch {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: string;
  dueDate?: string | null;
  startDate?: string | null;
  nextStep?: string | null;
  nextStepDate?: string | null;
  deptId?: string | null;
  ownerPersonId?: string | null;
  tags?: string[];
  moneyImpactCents?: number | null;
}

/**
 * The fields worth pinning when he sets them.
 *
 * Everything ClickUp and the cockpit both hold. The fields only the cockpit
 * has — next step, its date, the money — need no pin, because the mirror's
 * upsert does not write them at all.
 */
const PIN_ON_EDIT = [
  'title', 'description', 'priority', 'status', 'dueDate', 'startDate',
  'deptId', 'ownerPersonId', 'tags',
] as const;

/**
 * Which of a ClickUp list's own words means the status he picked.
 *
 * The cockpit holds statuses as slugs — `in_progress`, `make_it_happened` —
 * because that is what the mirror makes of whatever word the list used. Going
 * the other way needs the word back, and ClickUp rejects anything that is not
 * one of the list's own. Every list in the workspace defines its own set, so
 * there is nothing to hardcode: the list is asked, and the answer is searched.
 *
 * The exact word wins over a mapped one, so a list carrying both "Open" and
 * "To Do" moves to the one he actually chose rather than whichever came first.
 */
export function remoteStatusFor(target: string, listStatuses: readonly string[]): string | null {
  const want = target.toLowerCase().trim();
  if (!want) return null;
  const exact = listStatuses.find((s) => s.toLowerCase().trim() === want);
  if (exact !== undefined) return exact;
  // Then whatever this list has that the mirror would read as the same status.
  return listStatuses.find((s) => mapClickUpStatus(s) === want) ?? null;
}

export interface MirroredEditResult {
  ok: true;
  /** The fields ClickUp took. */
  pushed: string[];
  /**
   * Why ClickUp did not take the rest, if it did not. The edit is saved either
   * way — this is for the screen to mention, not to fail on.
   */
  clickupError?: string;
}

export async function editMirroredTask(
  taskId: string,
  patch: MirroredTaskPatch,
  actor: string,
  adapter: ClickUpAdapter = createClickUpAdapter(),
): Promise<MirroredEditResult | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNotNull(tasks.clickupId)))
    .limit(1);
  if (!row?.clickupId) return { ok: false, error: 'That task is not mirrored from ClickUp.' };

  // Only what ClickUp owns, and only what actually changed: sending the whole
  // task back would overwrite whatever the team changed in the meantime with
  // whatever his page happened to be showing.
  const remote: ClickUpTaskPatch = {};
  if (patch.title !== undefined && patch.title !== row.title) remote.name = patch.title;
  if (patch.description !== undefined && patch.description !== row.description) {
    remote.description = patch.description;
  }
  if (patch.priority !== undefined && patch.priority !== row.priority) {
    remote.priority = PRIORITY_TO_CLICKUP[patch.priority];
  }
  if (patch.dueDate !== undefined && patch.dueDate !== row.dueDate) {
    // A date with no time means the end of that day where he is, which is what
    // "due Thursday" means to everyone except a timezone.
    remote.dueDateMs = patch.dueDate ? Date.parse(`${patch.dueDate}T23:59:00+03:00`) : null;
  }

  const troubles: string[] = [];
  const pushed: string[] = [];

  if (Object.keys(remote).length > 0) {
    const result = await adapter.updateTask(row.clickupId, remote).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : 'unknown',
    }));
    if (result.ok) pushed.push(...Object.keys(remote));
    else troubles.push(`it would not take the edit (${result.error ?? 'unknown'})`);
  }

  /*
   * The status is its own call: ClickUp has a separate endpoint for it, and it
   * only takes one of the words this task's list defines.
   *
   * What is stored here is what HE picked. It used to be whatever the mirror
   * made of ClickUp's confirmation, which was right while ClickUp decided —
   * and is wrong now that it does not: a push that fails would have left the
   * cell showing the old status with no explanation.
   */
  if (patch.status !== undefined && patch.status !== row.status) {
    const listStatuses = await adapter.listStatuses(row.clickupId).catch(() => [] as string[]);
    const word = remoteStatusFor(patch.status, listStatuses);
    if (word === null) {
      troubles.push(
        listStatuses.length === 0
          ? 'it would not say which statuses this list allows, so the status was not sent'
          : `its list here has no status like “${patch.status}” (it offers ${listStatuses.join(', ')})`,
      );
    } else {
      const moved = await adapter.setTaskStatus(row.clickupId, word).catch((e: unknown) => ({
        ok: false as const,
        status: null,
        error: e instanceof Error ? e.message : 'unknown',
      }));
      if (moved.ok) pushed.push('status');
      else troubles.push(`it would not move the status (${moved.error ?? 'unknown'})`);
    }
  }

  /*
   * Everything he touched becomes his.
   *
   * Without this the sync would revert, five minutes later and with nothing on
   * screen to say why, exactly the edits ClickUp declined — which is the case
   * this rewrite exists to survive. Pinning only what the patch carried keeps
   * the rest of the row following ClickUp, so the team's work still arrives.
   */
  const pinned = new Set(row.pinnedFields);
  for (const field of PIN_ON_EDIT) {
    if (patch[field] !== undefined) pinned.add(field);
  }

  await writeAudit({
    actor,
    action: 'clickup.edit',
    entityType: 'task',
    entityId: row.id,
    before: {
      title: row.title,
      description: row.description,
      priority: row.priority,
      status: row.status,
      dueDate: row.dueDate,
      deptId: row.deptId,
      ownerPersonId: row.ownerPersonId,
      tags: row.tags,
      moneyImpactCents: row.moneyImpactCents,
    },
    after: { ...patch, pushedToClickUp: pushed, clickupRefused: troubles },
  });

  await db
    .update(tasks)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
      ...(patch.nextStep !== undefined ? { nextStep: patch.nextStep } : {}),
      ...(patch.nextStepDate !== undefined ? { nextStepDate: patch.nextStepDate } : {}),
      ...(patch.deptId !== undefined ? { deptId: patch.deptId } : {}),
      ...(patch.ownerPersonId !== undefined ? { ownerPersonId: patch.ownerPersonId } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.moneyImpactCents !== undefined
        ? { moneyImpactCents: patch.moneyImpactCents }
        : {}),
      pinnedFields: [...pinned],
      lastTouchAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, row.id));

  return {
    ok: true,
    pushed,
    ...(troubles.length > 0
      ? { clickupError: `Saved here. ClickUp was not updated — ${troubles.join('; ')}.` }
      : {}),
  };
}
