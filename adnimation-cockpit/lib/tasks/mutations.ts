import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, taskComments, tasks } from '@/lib/db';
import { computeHeat } from './heat';
import { writeAudit } from '@/lib/audit';
import { isZombie, type TaskInput, type TaskPatch } from './types';

// Re-exported because half the callers reach for it through here.
export { isZombie };

export { computeHeat };

export async function createTask(input: TaskInput, actor: string) {
  const heat = computeHeat({
    priority: input.priority,
    dueDate: input.dueDate ?? null,
    moneyImpactCents: input.moneyImpactCents ?? null,
    blockedPeople: input.blockedPeople,
    ownerPersonId: input.ownerPersonId ?? null,
  });

  const [row] = await db
    .insert(tasks)
    .values({
      layer: 'mine', // Native tasks only; the company layer is written by the mirror.
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      status: input.status,
      dueDate: input.dueDate ?? null,
      startDate: input.startDate ?? null,
      nextStep: input.nextStep ?? null,
      nextStepDate: input.nextStepDate ?? null,
      // A task nobody has touched was last touched when it arrived.
      lastTouchAt: new Date(),
      deptId: input.deptId ?? null,
      ownerPersonId: input.ownerPersonId ?? null,
      parentId: input.parentId ?? null,
      tags: input.tags,
      moneyImpactCents: input.moneyImpactCents ?? null,
      blockedPeople: input.blockedPeople,
      recurrenceRule: input.recurrenceRule ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      heatScore: heat,
    })
    .returning();

  if (!row) throw new Error('Failed to create the task');
  await writeAudit({ actor, action: 'task.create', entityType: 'task', entityId: row.id, after: row });
  return row;
}

export async function updateTask(patch: TaskPatch, actor: string) {
  const [before] = await db.select().from(tasks).where(eq(tasks.id, patch.id)).limit(1);
  if (!before) throw new Error('Task not found');
  if (before.layer === 'company') {
    /*
     * ClickUp is the system of record for the company layer, so an edit to one
     * of its tasks goes through the write-through path, which puts it in
     * ClickUp first and pins the fields ClickUp cannot hold. Letting this
     * function write to the row directly would look like it worked until the
     * next poll reverted it.
     */
    throw new Error('Use editMirroredTask for a ClickUp task — it writes to ClickUp first.');
  }

  const merged = {
    priority: patch.priority ?? before.priority,
    dueDate: patch.dueDate !== undefined ? patch.dueDate : before.dueDate,
    moneyImpactCents:
      patch.moneyImpactCents !== undefined ? patch.moneyImpactCents : before.moneyImpactCents,
    blockedPeople: patch.blockedPeople ?? before.blockedPeople,
    ownerPersonId:
      patch.ownerPersonId !== undefined ? patch.ownerPersonId : before.ownerPersonId,
  };

  const [row] = await db
    .update(tasks)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
      ...(patch.deptId !== undefined ? { deptId: patch.deptId } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.recurrenceRule !== undefined ? { recurrenceRule: patch.recurrenceRule } : {}),
      ...(patch.nextStep !== undefined ? { nextStep: patch.nextStep } : {}),
      ...(patch.nextStepDate !== undefined ? { nextStepDate: patch.nextStepDate } : {}),
      priority: merged.priority,
      dueDate: merged.dueDate,
      moneyImpactCents: merged.moneyImpactCents,
      blockedPeople: merged.blockedPeople,
      ownerPersonId: merged.ownerPersonId,
      heatScore: computeHeat({ ...merged, blockedPeople: merged.blockedPeople ?? [] }),
      updatedAt: new Date(),
      /*
       * He touched it, so this is when it last moved. Separate from
       * updatedAt, which the ClickUp poll writes on every mirrored row
       * whether or not anything happened.
       */
      lastTouchAt: new Date(),
    })
    .where(eq(tasks.id, patch.id))
    .returning();

  await writeAudit({
    actor, action: 'task.update', entityType: 'task', entityId: patch.id, before, after: row,
  });
  return row;
}

export async function completeTask(id: string, actor: string) {
  // Read the status first: it is what undo puts back, and after the update it
  // is gone.
  const [was] = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);

  const [row] = await db
    .update(tasks)
    .set({ status: 'done', updatedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.layer, 'mine')))
    .returning();
  if (!row) throw new Error('Task not found, or it belongs to the ClickUp layer');
  await writeAudit({
    actor, action: 'task.complete', entityType: 'task', entityId: id,
    before: { status: was?.status ?? 'open' }, after: { status: 'done' },
  });
  return row;
}

/**
 * Spec 6.3 — snoozing is counted. Three snoozes marks the task a Zombie, which
 * surfaces it for a keep-or-kill decision at the management meeting.
 */
export async function snoozeTask(id: string, until: Date, actor: string) {
  const [was] = await db
    .select({ snoozeUntil: tasks.snoozeUntil, snoozeCount: tasks.snoozeCount })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);

  const [row] = await db
    .update(tasks)
    .set({
      snoozeUntil: until,
      snoozeCount: sql`${tasks.snoozeCount} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), eq(tasks.layer, 'mine')))
    .returning();
  if (!row) throw new Error('Task not found, or it belongs to the ClickUp layer');
  await writeAudit({
    actor, action: 'task.snooze', entityType: 'task', entityId: id,
    // The count comes back too — three snoozes marks a Zombie, and an undone
    // snooze that still counted would push a task there on a click he took back.
    before: { snoozeUntil: was?.snoozeUntil ?? null, snoozeCount: was?.snoozeCount ?? 0 },
    after: { until, snoozeCount: row.snoozeCount, zombie: isZombie(row.snoozeCount) },
  });
  return row;
}

/** Nothing is ever deleted (CLAUDE.md §2) — archive only. */
export async function archiveTask(id: string, actor: string) {
  const [row] = await db
    .update(tasks)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.layer, 'mine'), isNull(tasks.archivedAt)))
    .returning();
  if (!row) throw new Error('Task not found, or already archived');
  // It was not archived a moment ago — that is exactly what undo restores.
  await writeAudit({
    actor, action: 'task.archive', entityType: 'task', entityId: id,
    before: { archivedAt: null }, after: { archivedAt: row.archivedAt },
  });
  return row;
}

export async function addComment(taskId: string, body: string, author: string) {
  const [row] = await db.insert(taskComments).values({ taskId, author, body }).returning();
  return row;
}

export async function listComments(taskId: string) {
  return db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId))
    .orderBy(taskComments.createdAt);
}

/** Recomputes heat for every open task — the days-overdue term drifts daily. */
export async function recomputeAllHeat(now = new Date()): Promise<number> {
  const open = await db
    .select({
      id: tasks.id,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      moneyImpactCents: tasks.moneyImpactCents,
      blockedPeople: tasks.blockedPeople,
      ownerPersonId: tasks.ownerPersonId,
      heatScore: tasks.heatScore,
    })
    .from(tasks)
    .where(isNull(tasks.archivedAt));

  let updated = 0;
  for (const row of open) {
    const next = computeHeat(row, now);
    if (next !== row.heatScore) {
      await db.update(tasks).set({ heatScore: next }).where(eq(tasks.id, row.id));
      updated += 1;
    }
  }
  return updated;
}
