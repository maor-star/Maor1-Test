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
 * The company layer used to be read-only here, which was defensible when the
 * cockpit could only read ClickUp — and it made most of his own task list a
 * screen he could look at and not use. So:
 *
 * · The fields ClickUp owns — title, description, priority, due date — are
 *   written there first, and mirrored only once ClickUp accepts them. If it
 *   refuses, nothing changes here either: a cockpit showing an edit the team
 *   never sees is worse than an edit that failed loudly.
 * · The status is written there too, but it needs translating first: the
 *   cockpit's word for a status is a slug, and ClickUp only accepts one of the
 *   words its own list defines. See remoteStatusFor.
 * · The fields ClickUp has nowhere to keep — the department he filed it under,
 *   the owner he assigned here, his tags, the money he attached — are written
 *   here and pinned, so the next poll stops overwriting them. Without that,
 *   what he set would be gone five minutes later with nothing to show why.
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

export async function editMirroredTask(
  taskId: string,
  patch: MirroredTaskPatch,
  actor: string,
  adapter: ClickUpAdapter = createClickUpAdapter(),
): Promise<{ ok: true; pushed: string[] } | { ok: false; error: string }> {
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

  if (Object.keys(remote).length > 0) {
    const result = await adapter.updateTask(row.clickupId, remote).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : 'unknown',
    }));
    if (!result.ok) {
      return {
        ok: false,
        error: `ClickUp rejected the edit: ${result.error ?? 'unknown'}. Nothing was changed here either.`,
      };
    }
  }

  /*
   * The status is its own call: ClickUp has a separate endpoint for it, and it
   * only takes one of the words this task's list defines.
   *
   * What is stored here is whatever the mirror makes of the word ClickUp
   * confirms — not the word he picked — so the row says what ClickUp says even
   * when the list's spelling differs from the cockpit's slug.
   */
  let storedStatus: string | undefined;
  if (patch.status !== undefined && patch.status !== row.status) {
    const listStatuses = await adapter.listStatuses(row.clickupId).catch(() => [] as string[]);
    const word = remoteStatusFor(patch.status, listStatuses);
    if (word === null) {
      return {
        ok: false,
        error:
          listStatuses.length === 0
            ? 'ClickUp would not say which statuses this task\u2019s list allows, so the status was left alone.'
            : `This task\u2019s ClickUp list has no status like \u201C${patch.status}\u201D. It offers: ${listStatuses.join(', ')}.`,
      };
    }
    const moved = await adapter.setTaskStatus(row.clickupId, word).catch((e: unknown) => ({
      ok: false as const,
      status: null,
      error: e instanceof Error ? e.message : 'unknown',
    }));
    if (!moved.ok) {
      return {
        ok: false,
        error: `ClickUp rejected the status change: ${moved.error ?? 'unknown'}. Nothing was changed here either.`,
      };
    }
    storedStatus = mapClickUpStatus(moved.status ?? word);
  }

  const pinned = new Set(row.pinnedFields);
  if (patch.deptId !== undefined && patch.deptId !== row.deptId) pinned.add('deptId');
  if (patch.ownerPersonId !== undefined && patch.ownerPersonId !== row.ownerPersonId) {
    pinned.add('ownerPersonId');
  }
  if (patch.tags !== undefined && patch.tags.join('|') !== row.tags.join('|')) pinned.add('tags');

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
    after: {
      ...patch,
      ...(storedStatus !== undefined ? { status: storedStatus } : {}),
      pushedToClickUp: [...Object.keys(remote), ...(storedStatus !== undefined ? ['status'] : [])],
    },
  });

  await db
    .update(tasks)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(storedStatus !== undefined ? { status: storedStatus } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      // ClickUp has nowhere to keep these, and the mirror's upsert does not
      // write them, so they simply stay put across a poll without pinning.
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
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, row.id));

  return {
    ok: true,
    pushed: [...Object.keys(remote), ...(storedStatus !== undefined ? ['status'] : [])],
  };
}
