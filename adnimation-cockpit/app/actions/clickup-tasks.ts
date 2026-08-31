'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, tasks } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { createClickUpAdapter } from '@/lib/integrations/clickup';
import { editMirroredTask } from '@/lib/tasks/clickup-edit';
import { TASK_PRIORITIES } from '@/lib/tasks/types';
import { mapClickUpStatus } from '@/lib/sync/clickup-map';
import { removeFinished } from '@/lib/sync/clickup-mirror';
import { writeAudit } from '@/lib/audit';

/**
 * Changing a mirrored ClickUp task's status, from the cockpit.
 *
 * This is the one place the cockpit writes to ClickUp. ClickUp stays the system
 * of record, so the order matters: write there first, and only update the
 * mirror once ClickUp has confirmed. Doing it the other way round would leave
 * the cockpit showing a status the team never sees.
 *
 * Closing a task removes it from the mirror rather than storing a done row —
 * the cockpit carries open work only (see lib/sync/clickup-mirror.ts).
 */

export interface TaskActionResult {
  ok: boolean;
  error?: string;
  status?: string;
  closed?: boolean;
}

const inputSchema = z.object({
  taskId: z.string().uuid(),
  status: z.string().trim().min(1).max(80),
});

export async function setClickUpStatusAction(formData: FormData): Promise<TaskActionResult> {
  const user = await requireUser();
  const parsed = inputSchema.safeParse({
    taskId: formData.get('taskId'),
    status: formData.get('status'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.flatten().formErrors[0] ?? 'Invalid request' };
  }

  const [row] = await db
    .select({ id: tasks.id, clickupId: tasks.clickupId, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.id, parsed.data.taskId), isNotNull(tasks.clickupId)))
    .limit(1);

  if (!row?.clickupId) {
    return { ok: false, error: 'That task is not mirrored from ClickUp.' };
  }

  const adapter = createClickUpAdapter();
  const result = await adapter
    .setTaskStatus(row.clickupId, parsed.data.status)
    .catch((e: unknown) => ({
      ok: false as const,
      status: null,
      error: e instanceof Error ? e.message : 'unknown',
    }));

  if (!result.ok) {
    return {
      ok: false,
      error: `ClickUp rejected the change: ${result.error ?? 'unknown'}. Nothing was changed here either.`,
    };
  }

  const confirmed = result.status ?? parsed.data.status;
  const mapped = mapClickUpStatus(confirmed);

  await writeAudit({
    actor: user.email,
    action: 'clickup.set_status',
    entityType: 'task',
    entityId: row.id,
    before: { status: row.status },
    after: { status: mapped, clickupStatus: confirmed },
  });

  if (mapped === 'done') {
    await removeFinished([row.clickupId]);
    revalidatePath('/tasks');
    revalidatePath('/');
    return { ok: true, status: confirmed, closed: true };
  }

  await db
    .update(tasks)
    .set({ status: mapped, updatedAt: new Date(), lastSyncedAt: new Date() })
    .where(eq(tasks.id, row.id));

  revalidatePath('/tasks');
  revalidatePath('/');
  return { ok: true, status: confirmed, closed: false };
}

/**
 * The statuses this task's own list allows. ClickUp rejects anything else, so
 * the picker offers the list's words rather than a hardcoded set that would
 * fail on half the workspace.
 */
export async function clickUpStatusesAction(taskId: string): Promise<string[]> {
  await requireUser();

  const [row] = await db
    .select({ clickupId: tasks.clickupId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!row?.clickupId) return [];
  return createClickUpAdapter()
    .listStatuses(row.clickupId)
    .catch(() => []);
}

/**
 * Editing a mirrored task, properly.
 *
 * The company layer used to be read-only here, which was defensible when the
 * cockpit could only read ClickUp — but it made his own list a screen he could
 * look at and not use. So the fields ClickUp holds are written there first and
 * mirrored only once it accepts them, and the fields ClickUp has nowhere to
 * keep are written here and pinned, so the next poll leaves them alone.
 *
 * If ClickUp refuses, nothing changes here either: a cockpit showing an edit
 * the team never sees is worse than an edit that failed loudly.
 */
const editSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(1, 'A task needs a title').max(300).optional(),
  description: z.string().trim().max(20_000).nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: z.string().trim().nullable().optional(),
  deptId: z.string().uuid().nullable().optional(),
  ownerPersonId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  moneyImpactCents: z.number().int().nonnegative().nullable().optional(),
});

const emptyToNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function editClickUpTaskAction(formData: FormData): Promise<TaskActionResult> {
  const user = await requireUser();

  const rawTags = String(formData.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const rawMoney = String(formData.get('moneyImpact') ?? '').trim();

  const parsed = editSchema.safeParse({
    taskId: formData.get('id'),
    title: formData.get('title') ?? undefined,
    description: emptyToNull(formData.get('description')),
    priority: formData.get('priority') ?? undefined,
    dueDate: emptyToNull(formData.get('dueDate')),
    deptId: emptyToNull(formData.get('deptId')),
    ownerPersonId: emptyToNull(formData.get('ownerPersonId')),
    tags: rawTags,
    moneyImpactCents: rawMoney === '' ? null : Math.round(Number(rawMoney) * 100),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.flatten().formErrors[0] ?? 'That is not a valid edit' };
  }

  const { taskId, ...patch } = parsed.data;
  const result = await editMirroredTask(taskId, patch, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath('/');
  return { ok: true };
}

/**
 * Cutting a task loose from ClickUp.
 *
 * The escape hatch he asked for: when ClickUp will not take an edit — a list
 * he cannot write to, a field it does not have, a token that has lost its
 * permissions — the task becomes his, with his fields, and stops being
 * mirrored. The ClickUp task is left exactly as it is; this only stops the
 * cockpit following it.
 *
 * One-way on purpose. Re-attaching would mean deciding whose version wins,
 * and that is a question with no safe default.
 */
export async function detachFromClickUpAction(formData: FormData): Promise<TaskActionResult> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not a task' };

  const [row] = await db
    .select({ id: tasks.id, clickupId: tasks.clickupId, clickupUrl: tasks.clickupUrl, title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.id, id.data), isNotNull(tasks.clickupId)))
    .limit(1);
  if (!row?.clickupId) return { ok: false, error: 'That task is not mirrored from ClickUp.' };

  await writeAudit({
    actor: user.email,
    action: 'clickup.detach',
    entityType: 'task',
    entityId: row.id,
    before: { clickupId: row.clickupId, clickupUrl: row.clickupUrl, layer: 'company' },
    after: { layer: 'mine', title: row.title },
  });

  await db
    .update(tasks)
    .set({
      layer: 'mine',
      clickupId: null,
      clickupUrl: null,
      pinnedFields: [],
      lastSyncedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, row.id));

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${row.id}`);
  revalidatePath('/');
  return { ok: true };
}
