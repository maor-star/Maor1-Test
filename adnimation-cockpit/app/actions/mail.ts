'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { dismissThread } from '@/lib/mail/service';
import { replyToThread } from '@/lib/mail/send';

/**
 * The one thing the screen can do to a thread.
 *
 * The cockpit holds a readonly scope, so it cannot reply, archive or label.
 * Marking a thread handled is a note to himself, kept here — and the next sync
 * clears it the moment he actually answers in Gmail.
 */
const input = z.object({
  threadId: z.string().min(1).max(80),
  undo: z.boolean().default(false),
});

export async function dismissThreadAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();

  const parsed = input.safeParse({
    threadId: String(formData.get('threadId') ?? '').trim(),
    undo: String(formData.get('undo') ?? '') === '1',
  });
  if (!parsed.success) return { ok: false, error: 'Not a thread' };

  try {
    await dismissThread(parsed.data.threadId, parsed.data.undo);
    revalidatePath('/mail');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update the thread' };
  }
}

/**
 * Reply, from here.
 *
 * The cockpit held a read-only Gmail scope, so a thread he had to answer sent
 * him to Gmail and back. Sending needs gmail.send, granted separately — where
 * it has not been, this says exactly that rather than reporting a broken
 * integration.
 */
export async function replyAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; needsScope?: boolean }> {
  await requireUser();

  const parsed = z
    .object({
      threadId: z.string().min(1).max(80),
      text: z.string().trim().min(1, 'Write something first').max(20_000),
    })
    .safeParse({
      threadId: String(formData.get('threadId') ?? ''),
      text: String(formData.get('text') ?? ''),
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Could not send it' };
  }

  const result = await replyToThread(parsed.data.threadId, parsed.data.text);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error ?? 'Could not send it',
      ...(result.needsScope ? { needsScope: true } : {}),
    };
  }

  revalidatePath('/mail');
  revalidatePath('/');
  return { ok: true };
}
