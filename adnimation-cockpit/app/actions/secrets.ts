'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth/session';
import { setSecret } from '@/lib/secrets/store';
import { SECRET_KEYS } from '@/lib/secrets/catalogue';

/**
 * Setting a credential.
 *
 * Owner only: a key is the ability to act as the company somewhere else, and
 * that is not the Chief of Staff's to hand out. The key name must be one the
 * cockpit declares — a settings screen that accepts anything is one where a
 * typo looks exactly like a working credential.
 *
 * Nothing here returns the value, logs it, or puts it in an error.
 */
export interface SecretActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export async function setSecretAction(formData: FormData): Promise<SecretActionResult> {
  const user = await requireOwner();

  const parsed = z
    .object({
      key: z.enum(SECRET_KEYS as [string, ...string[]]),
      value: z.string().max(8000),
    })
    .safeParse({
      key: String(formData.get('key') ?? ''),
      value: String(formData.get('value') ?? ''),
    });
  if (!parsed.success) return { ok: false, error: 'That is not a credential this cockpit uses.' };

  await setSecret(parsed.data.key, parsed.data.value, user.email);
  revalidatePath('/settings');
  revalidatePath('/copilot');
  revalidatePath('/');

  return {
    ok: true,
    message: parsed.data.value.trim()
      ? 'Saved. It takes effect on the next run, with no deploy.'
      : 'Cleared.',
  };
}
