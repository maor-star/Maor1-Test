'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/session';
import { db, tasks } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { ACCESS_LEVELS, canManageAccess, type AccessLevel } from '@/lib/tasks/access';
import { grantAccess, revokeAccess } from '@/lib/tasks/access-service';
import type { ActionResult } from './tasks';

/**
 * The star, and the guest list.
 *
 * Both are his alone — not the operator's. The star is the one control on this
 * screen that is about him rather than about the work, and the guest list is
 * the key to the board.
 *
 * Every one of these re-checks the role on the server. The gear and the star
 * are already hidden from anybody else, but a hidden button is not a closed
 * door: a server action is an HTTP endpoint, and anyone who can reach the
 * screen can call it with an id they typed themselves.
 */

const starSchema = z.object({ id: z.string().uuid(), isPrivate: z.boolean() });

export async function setTaskPrivateAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!canManageAccess(user)) return { ok: false, error: 'Only the owner can make a task private' };

  const parsed = starSchema.safeParse({
    id: formData.get('id'),
    isPrivate: formData.get('isPrivate') === 'true',
  });
  if (!parsed.success) return { ok: false, error: 'That did not look like a task' };

  await db.update(tasks).set({ isPrivate: parsed.data.isPrivate }).where(eq(tasks.id, parsed.data.id));

  await writeAudit({
    actor: user.email,
    action: parsed.data.isPrivate ? 'task.made_private' : 'task.made_shared',
    entityType: 'task',
    entityId: parsed.data.id,
    after: { isPrivate: parsed.data.isPrivate },
  });

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${parsed.data.id}`);
  return { ok: true, id: parsed.data.id };
}

const grantSchema = z.object({
  email: z.string().trim().min(3),
  level: z.enum(ACCESS_LEVELS as unknown as [AccessLevel, ...AccessLevel[]]),
});

export async function grantTaskAccessAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!canManageAccess(user)) return { ok: false, error: 'Only the owner can give access' };

  const parsed = grantSchema.safeParse({
    email: formData.get('email'),
    level: formData.get('level') ?? 'view',
  });
  if (!parsed.success) return { ok: false, error: 'Pick a person and a level' };

  const result = await grantAccess(parsed.data.email, parsed.data.level, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/tasks');
  return { ok: true };
}

export async function revokeTaskAccessAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!canManageAccess(user)) return { ok: false, error: 'Only the owner can take access away' };

  const email = String(formData.get('email') ?? '');
  if (!email) return { ok: false, error: 'Nobody to remove' };

  const result = await revokeAccess(email, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/tasks');
  return { ok: true };
}
