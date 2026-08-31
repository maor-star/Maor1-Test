import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, taskComments, tasks } from '@/lib/db';
import { computeHeat } from './heat';
import { writeAudit } from '@/lib/audit';
import { type TaskInput, type TaskPatch, ZOMBIE_SNOOZE_THRESHOLD } from './types';

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
      priority: merged.priority,
      dueDate: merged.dueDate,
      moneyImpactCents: merged.moneyImpactCents,
      blockedPeople: merged.blockedPeople,
      ownerPersonId: merged.ownerPersonId,
      heatScore: computeHeat({ ...merged, blockedPeople: merged.blockedPeople ?? [] }),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, patch.id))
    .returning();

  await writeAudit({
    actor, action: 'task.update', entityType: 'task', entityId: patch.id, before, after: row,
  });
  return row;
}

export async function completeTask(id: string, actor: string) {
  const [row] = await db
    .update(tasks)
    .set({ status: 'done', updatedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.layer, 'mine')))
    .returning();
  if (!row) throw new Error('Task not found, or it belongs to the ClickUp layer');
  await writeAudit({ actor, action: 'task.complete', entityType: 'task', entityId: id });
  return row;
}

/**
 * Spec 6.3 — snoozing is counted. Three snoozes marks the task a Zombie, which
 * surfaces it for a keep-or-kill decision at the management meeting.
 */
export async function snoozeTask(id: string, until: Date, actor: string) {
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
    after: { until, snoozeCount: row.snoozeCount, zombie: isZombie(row.snoozeCount) },
  });
  return row;
}

export function isZombie(snoozeCount: number): boolean {
  return snoozeCount >= ZOMBIE_SNOOZE_THRESHOLD;
}

/** Nothing is ever deleted (CLAUDE.md §2) — archive only. */
export async function archiveTask(id: string, actor: string) {
  const [row] = await db
    .update(tasks)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.layer, 'mine'), isNull(tasks.archivedAt)))
    .returning();
  if (!row) throw new Error('Task not found, or already archived');
  await writeAudit({ actor, action: 'task.archive', entityType: 'task', entityId: id });
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
