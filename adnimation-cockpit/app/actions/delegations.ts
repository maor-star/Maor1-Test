'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { checkForReplies } from '@/lib/delegation/replies';

export interface ReplyCheckResult {
  ok: boolean;
  checked: number;
  found: number;
  error?: string;
}

/**
 * Reads Slack and email for answers to what was handed off.
 *
 * Run on demand rather than on every page load: it makes one API call per open
 * delegation, and the CEO opening the tracker twice in a minute should not cost
 * two rounds of them.
 */
export async function checkRepliesAction(): Promise<ReplyCheckResult> {
  await requireUser();

  try {
    const result = await checkForReplies();
    revalidatePath('/delegations');
    revalidatePath('/');
    return {
      ok: result.unavailable === null,
      checked: result.checked,
      found: result.found,
      ...(result.unavailable ? { error: result.unavailable } : {}),
    };
  } catch (e) {
    return {
      ok: false,
      checked: 0,
      found: 0,
      error: e instanceof Error ? e.message : 'Could not check for replies',
    };
  }
}
