'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { setTarget } from '@/lib/control/targets';
import { ACTIVITY_LINES } from '@/lib/control/lines';
import { TARGET_BASES } from '@/lib/control/target-rules';

/**
 * Setting what a pillar is meant to earn.
 *
 * Money arrives from the form in whole dollars, because that is what he types,
 * and is stored in minor units like every other figure here (CLAUDE.md §10).
 * An empty box clears the month's target rather than storing a zero — a target
 * of nothing and no target at all are different states, and only one of them
 * should turn a tile red.
 */
const schema = z.object({
  line: z.enum(ACTIVITY_LINES),
  /** Any day in the month it applies to. */
  month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  target: z.string().trim(),
  basis: z.enum(TARGET_BASES),
});

export async function setLineTargetAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();

  const parsed = schema.safeParse({
    line: String(formData.get('line') ?? ''),
    month: String(formData.get('month') ?? '').slice(0, 10) || new Date().toISOString().slice(0, 7),
    target: String(formData.get('target') ?? ''),
    basis: String(formData.get('basis') ?? 'gross'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That is not a target' };
  }

  const raw = parsed.data.target.replace(/[,\s$]/g, '');
  if (raw !== '' && !/^\d+(\.\d+)?$/.test(raw)) {
    return { ok: false, error: 'Give it as a number of dollars' };
  }

  const month = parsed.data.month.length === 7 ? `${parsed.data.month}-01` : parsed.data.month;

  await setTarget(
    {
      line: parsed.data.line,
      month,
      targetCents: raw === '' ? null : Math.round(Number(raw) * 100),
      basis: parsed.data.basis,
    },
    user.email,
  );

  revalidatePath('/');
  revalidatePath('/revenue');
  return { ok: true };
}
