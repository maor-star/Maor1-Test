'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, tasks } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { createClickUpAdapter } from '@/lib/integrations/clickup';
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
