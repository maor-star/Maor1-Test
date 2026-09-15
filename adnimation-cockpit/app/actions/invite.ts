'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { canManageAccess, ACCESS_LEVELS } from '@/lib/tasks/access';
import { acceptInvite, inviteToTasks, resendInvite, revokeInvite } from '@/lib/tasks/invite-service';
import { MIN_PASSWORD } from '@/lib/tasks/invite-limits';

/**
 * Inviting somebody, and their side of it.
 *
 * Two actions with opposite gates, which is why they sit together: one is his
 * alone, and the other has to be callable by a stranger holding a link — the
 * person taking up the invitation has no session yet, by definition. What
 * protects the second is the token, so it is never mixed with anything a
 * session would decide.
 */

export interface InviteResult {
  ok: boolean;
  error?: string;
  /** Present when the invite was stored but the mail did not go. */
  link?: string;
}

const inviteSchema = z.object({
  email: z.string().trim().min(3).max(200),
  name: z.string().trim().max(120).nullish(),
  level: z.enum(ACCESS_LEVELS),
  taskId: z.string().uuid().nullish(),
  note: z.string().trim().max(2000).nullish(),
});

const orNull = (v: FormDataEntryValue | null) => (String(v ?? '').trim() === '' ? null : String(v));

export async function inviteToTasksAction(formData: FormData): Promise<InviteResult> {
  const user = await requireUser();
  if (!canManageAccess(user)) {
    return { ok: false, error: 'Only the owner invites people to this board' };
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    name: orNull(formData.get('name')),
    level: formData.get('level') ?? 'view',
    taskId: orNull(formData.get('taskId')),
    note: orNull(formData.get('note')),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.flatten().formErrors[0] ?? 'That is not a valid invite' };
  }

  const result = await inviteToTasks({
    ...parsed.data,
    actor: user.email,
    actorName: user.name || user.email,
  });

  revalidatePath('/tasks');
  return result.ok
    ? { ok: true }
    : { ok: false, error: result.error, ...(result.link ? { link: result.link } : {}) };
}

/**
 * A fresh link for somebody who already has access.
 *
 * The case this exists for is not "it never arrived" — it is "I set a password
 * and it will not let me in". Both have the same answer, and a link that has
 * been used is worth nothing, so this mints a new one.
 */
export async function resendInviteAction(formData: FormData): Promise<InviteResult> {
  const user = await requireUser();
  if (!canManageAccess(user)) {
    return { ok: false, error: 'Only the owner invites people to this board' };
  }
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { ok: false, error: 'Nobody to send to' };

  const result = await resendInvite(email, user.email, user.name || user.email);
  revalidatePath('/tasks');
  return result.ok
    ? { ok: true }
    : { ok: false, error: result.error, ...(result.link ? { link: result.link } : {}) };
}

export async function revokeInviteAction(formData: FormData): Promise<InviteResult> {
  const user = await requireUser();
  if (!canManageAccess(user)) return { ok: false, error: 'Only the owner manages this board' };
  const id = z.string().uuid().safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not an invitation' };

  await revokeInvite(id.data, user.email);
  revalidatePath('/tasks');
  return { ok: true };
}

/**
 * Their half: setting a name and a password behind the link.
 *
 * No session, and none expected. The token in the form is the whole of the
 * authorisation, and every way of it being invalid gets the same answer so the
 * page cannot be used to find out who has been invited.
 */
export interface AcceptResult {
  ok: boolean;
  error?: string;
  email?: string;
}

const acceptSchema = z.object({
  token: z.string().trim().min(32).max(200),
  name: z.string().trim().min(2, 'Please put in your name').max(120),
  password: z.string().min(MIN_PASSWORD, `A password needs at least ${MIN_PASSWORD} characters`),
  confirm: z.string(),
});

export async function acceptInviteAction(formData: FormData): Promise<AcceptResult> {
  const parsed = acceptSchema.safeParse({
    token: formData.get('token'),
    name: formData.get('name'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.flatten().formErrors[0] ?? 'Please check the form' };
  }
  if (parsed.data.password !== parsed.data.confirm) {
    return { ok: false, error: 'The two passwords are not the same' };
  }

  const result = await acceptInvite(parsed.data);
  return result.ok ? { ok: true, email: result.email } : { ok: false, error: result.error };
}
