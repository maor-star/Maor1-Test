import { and, eq, isNotNull } from 'drizzle-orm';
import { db, tasks } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { PRIORITY_TO_CLICKUP, createClickUpAdapter } from '@/lib/integrations/clickup';
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
 * · The fields ClickUp has nowhere to keep — the department he filed it under,
 *   the owner he assigned here, his tags, the money he attached — are written
 *   here and pinned, so the next poll stops overwriting them. Without that,
 *   what he set would be gone five minutes later with nothing to show why.
 */
export interface MirroredTaskPatch {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  deptId?: string | null;
  ownerPersonId?: string | null;
  tags?: string[];
  moneyImpactCents?: number | null;
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
      dueDate: row.dueDate,
      deptId: row.deptId,
      ownerPersonId: row.ownerPersonId,
      tags: row.tags,
      moneyImpactCents: row.moneyImpactCents,
    },
    after: { ...patch, pushedToClickUp: Object.keys(remote) },
  });

  await db
    .update(tasks)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
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

  return { ok: true, pushed: Object.keys(remote) };
}
