'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { canEditTask, isAccountHolder } from '@/lib/tasks/access';
import { getTask } from '@/lib/tasks/queries';
import {
  dismissMail, mailForTask, messagesIn, restoreMail, sweepTaskMail, type MailMessage,
} from '@/lib/tasks/mail-links';

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

/**
 * The mail itself, read where the task is.
 *
 * Gated to the account holders and to nobody else. Everything else on this
 * board is work — a title, a due date, who is on it — and a person he grants
 * the board to is meant to see the work. The contents of his mailbox are a
 * different kind of thing: a guest can see that a task has three emails on it
 * and cannot read a word of them. That is a deliberate narrowing of the grant,
 * not an oversight, and widening it would be his call to make explicitly.
 *
 * Fetched when he opens one rather than with the row — a board of forty tasks
 * would otherwise carry a hundred emails to the browser to show two.
 */
export async function readMailAction(
  taskId: string,
  threadId: string,
): Promise<{ ok: true; messages: MailMessage[] } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!isAccountHolder(user)) return { ok: false, error: 'Not yours to read' };

  const gate = await mayEdit(taskId);
  if (gate.error) return { ok: false, error: gate.error.error };

  /*
   * And it must be a thread that is actually on this task. Without this, the
   * action would read any thread in the mailbox for anyone who knows a task id
   * — the task is the door, so the thread has to be behind it.
   */
  const onTask = (await mailForTask(taskId)).some((m) => m.threadId === threadId);
  if (!onTask) return { ok: false, error: 'That email is not on this task' };

  return { ok: true, messages: await messagesIn(threadId) };
}
