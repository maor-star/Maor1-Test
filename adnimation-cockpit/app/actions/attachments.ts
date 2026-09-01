'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import {
  opportunityAttachments, taskAttachments, threadAttachments, type AttachmentItem,
} from '@/lib/attachments/service';

/**
 * What is attached to this thing.
 *
 * One action for three sources, because the screen asking is always asking the
 * same question — "there is a file here, let me see it" — and the answer has
 * the same shape whether it came from ClickUp or from Gmail.
 *
 * Never throws at the caller: a ClickUp outage or an expired Google token has
 * to read as "could not fetch them", not as a task row that will not open.
 */

const input = z.object({
  kind: z.enum(['task', 'opportunity', 'thread']),
  id: z.string().min(1).max(200),
});

export type AttachmentsResult =
  | { ok: true; items: AttachmentItem[] }
  | { ok: false; error: string };

export async function attachmentsAction(
  kind: 'task' | 'opportunity' | 'thread',
  id: string,
): Promise<AttachmentsResult> {
  await requireUser();

  const parsed = input.safeParse({ kind, id });
  if (!parsed.success) return { ok: false, error: 'Not something with files on it' };

  try {
    const items =
      parsed.data.kind === 'task'
        ? await taskAttachments(parsed.data.id)
        : parsed.data.kind === 'opportunity'
          ? await opportunityAttachments(parsed.data.id)
          : await threadAttachments(parsed.data.id);
    return { ok: true, items };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not read the attachments',
    };
  }
}
