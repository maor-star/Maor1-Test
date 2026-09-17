'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { canEditTask } from '@/lib/tasks/access';
import { getTask } from '@/lib/tasks/queries';
import { dismissMail, mailForTask, restoreMail, sweepTaskMail } from '@/lib/tasks/mail-links';

/**
 * The mail hanging off a task, as the screen works it.
 *
 * The finding is done by a job every twenty minutes (deploy/task-mail.mjs), so
 * nothing here goes near Gmail. These are the two things he does with what it
 * found: throw one away, and — when he does not want to wait for the timer —
 * make it look again now.
 */

export interface MailActionResult {
  ok: boolean;
  error?: string;
  notice?: string;
}

/**
 * The same gate the task mutations use.
 *
 * The task is read as the owner deliberately: asking for it as the caller
 * would make a private task come back empty and "not yours" would be
 * indistinguishable from "no such task" in the code, though not in the answer.
 * The answer is the same either way, so this is never a way to learn that a
 * private task exists.
 */
async function mayEdit(taskId: string) {
  const user = await requireUser();
  const denied = { ok: false as const, error: 'No task with that id' };
  const task = await getTask(taskId, true);
  if (!task || !canEditTask(task, user)) return { user, error: denied };
  return { user, error: null };
}

/** Not this one. It never comes back on its own. */
export async function dismissMailAction(formData: FormData): Promise<MailActionResult> {
  const taskId = String(formData.get('taskId') ?? '');
  const threadId = String(formData.get('threadId') ?? '');
  if (!taskId || !threadId) return { ok: false, error: 'Nothing to dismiss' };

  const gate = await mayEdit(taskId);
  if (gate.error) return gate.error;

  await dismissMail(taskId, threadId, gate.user.email);
  revalidatePath('/tasks');
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true, notice: 'Taken off this task' };
}

/** Put one back that he threw away. */
export async function restoreMailAction(formData: FormData): Promise<MailActionResult> {
  const taskId = String(formData.get('taskId') ?? '');
  const threadId = String(formData.get('threadId') ?? '');
  if (!taskId || !threadId) return { ok: false, error: 'Nothing to restore' };

  const gate = await mayEdit(taskId);
  if (gate.error) return gate.error;

  await restoreMail(taskId, threadId);
  revalidatePath('/tasks');
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true, notice: 'Back on this task' };
}

/**
 * Look again, now.
 *
 * The sweep is over every open task rather than one, because that is the only
 * shape it comes in — and it takes about as long either way, since the cost is
 * reading the mirrored threads once.
 */
export async function findMailNowAction(): Promise<MailActionResult> {
  await requireUser();
  const result = await sweepTaskMail();
  revalidatePath('/tasks');
  return {
    ok: true,
    notice: `Read ${result.threadsSeen} threads against ${result.tasksSeen} open tasks.`,
  };
}

/** One task's mail, for a panel that opens on demand. */
export async function mailForTaskAction(taskId: string) {
  const gate = await mayEdit(taskId);
  if (gate.error) return { ok: false as const, error: gate.error.error };
  return { ok: true as const, items: await mailForTask(taskId) };
}
