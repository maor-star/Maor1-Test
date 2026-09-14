'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { getTask } from '@/lib/tasks/queries';
import { canEditTask } from '@/lib/tasks/access';
import { nudgeTask, senderIdentity, type NudgeOutcome } from '@/lib/tasks/nudge';

/**
 * Chasing a task, from the row it sits on.
 *
 * Behind the same gate as editing it: a Slack message in his name, to a
 * colleague, is not something a view-only guest sends — and the button being
 * hidden for them is not a closed door, since a server action is an HTTP
 * endpoint anybody who can reach the board can post a task id to.
 */
export interface NudgeActionResult {
  ok: boolean;
  error?: string;
  sent?: NudgeOutcome[];
  asHimself?: boolean;
  /** Said out loud, because he asked for a message that looks like his. */
  notice?: string;
}

const schema = z.object({
  taskId: z.string().uuid(),
  note: z.string().trim().max(1000).nullish(),
});

export async function nudgeTaskAction(formData: FormData): Promise<NudgeActionResult> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    taskId: formData.get('taskId'),
    note: String(formData.get('note') ?? '').trim() || null,
  });
  if (!parsed.success) return { ok: false, error: 'Not a task' };

  const task = await getTask(parsed.data.taskId, true);
  if (!task || !canEditTask(task, user)) return { ok: false, error: 'No task with that id' };

  const sender = await senderIdentity(user.email);
  const result = await nudgeTask(parsed.data.taskId, user.email, parsed.data.note ?? null, {
    sender,
  }).catch((e: unknown) => ({
    sent: [] as NudgeOutcome[],
    asHimself: false,
    error: e instanceof Error ? e.message : 'unknown',
  }));

  if ('error' in result && result.error) return { ok: false, error: result.error };
  if (result.sent.length === 0) {
    return { ok: false, error: 'Nobody is on this task yet — add a name and try again.' };
  }

  const failed = result.sent.filter((s) => !s.ok);
  revalidatePath('/tasks');
  revalidatePath(`/tasks/${parsed.data.taskId}`);

  return {
    ok: failed.length < result.sent.length,
    sent: result.sent,
    asHimself: result.asHimself,
    ...(failed.length > 0
      ? {
          error: failed
            .map((f) =>
              f.error === 'no_slack_id'
                ? `${f.name} has no Slack account on file`
                : `${f.name}: ${f.error ?? 'unknown'}`,
            )
            .join('; '),
        }
      : {}),
    ...(result.asHimself
      ? {}
      : {
          notice:
            'Sent by the cockpit bot under your name and picture. To send it as genuinely you, paste a Slack user token with the chat:write user scope as SLACK_USER_TOKEN on the Keys screen.',
        }),
  };
}
