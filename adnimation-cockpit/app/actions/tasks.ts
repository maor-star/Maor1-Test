'use server';

import { revalidatePath } from 'next/cache';
import { addDays } from 'date-fns';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { setLines } from '@/lib/control/tagging';
import {
  addComment, archiveTask, completeTask, createTask, snoozeTask, updateTask,
} from '@/lib/tasks/mutations';
import { commentInputSchema, taskInputSchema, taskPatchSchema } from '@/lib/tasks/types';
import { getTask, type TaskRow } from '@/lib/tasks/queries';
import { editMirroredTask } from '@/lib/tasks/clickup-edit';
import { assigneesOf, setAssignees } from '@/lib/tasks/assignees';
import { notifyAssigned, senderIdentity } from '@/lib/tasks/nudge';
import { canEditTask, canSeePrivate, isAccountHolder } from '@/lib/tasks/access';
import type { CockpitUser } from '@/lib/auth/session';

export interface ActionResult {
  ok: boolean;
  error?: string;
  /**
   * Something worth saying about a save that DID happen — ClickUp not taking
   * the copy it keeps, for instance. Not a failure: the edit is his and it is
   * stored, so this must not colour the cell red or revert what he chose.
   */
  notice?: string;
  /** Field-level messages, keyed by field name. */
  fieldErrors?: Record<string, string[]>;
  id?: string;
}

/** Turns a Zod failure into something the form can render inline. */
function fromZod(error: z.ZodError): ActionResult {
  const flat = error.flatten();
  return {
    ok: false,
    error: flat.formErrors[0] ?? 'The submitted data is not valid',
    fieldErrors: flat.fieldErrors as Record<string, string[]>,
  };
}

/**
 * Whether this person may change this particular task.
 *
 * Every mutation below goes through it, because a server action is an HTTP
 * endpoint. The screen already hides what somebody cannot do, but a hidden
 * button is not a closed door: anyone who can reach the board can post an id
 * they typed themselves.
 *
 * It reads the task as the owner deliberately. Asking for it as the caller
 * would make a private task come back empty and read as "no such task", and
 * the answer to "may I edit this" would be the same whether it did not exist
 * or was simply not theirs — which is the right answer to give them, but the
 * wrong one to decide on.
 */
async function forEdit(
  user: CockpitUser,
  id: string,
): Promise<{ error: ActionResult; task?: undefined } | { error?: undefined; task: TaskRow }> {
  const task = await getTask(id, true);
  if (!task) return { error: { ok: false, error: 'No task with that id' } };
  if (!canEditTask(task, user)) {
    // The same words either way, so this never becomes a way to find out that
    // a private task exists.
    return { error: { ok: false, error: 'No task with that id' } };
  }
  return { task };
}

/** The gate on its own, for the mutations that do not need the task itself. */
async function mayEdit(user: CockpitUser, id: string): Promise<ActionResult | null> {
  const gate = await forEdit(user, id);
  return gate.error ?? null;
}

const parseTags = (raw: FormDataEntryValue | null): string[] =>
  String(raw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

const parseMoney = (raw: FormDataEntryValue | null): number | null => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const dollars = Number(s);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  // Money is stored in minor units as an integer (CLAUDE.md §10).
  return Math.round(dollars * 100);
};

export async function createTaskAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  // A guest who may only read the board does not add to it.
  if (!isAccountHolder(user) && user.taskLevel !== 'edit') {
    return { ok: false, error: 'You have view-only access to this board' };
  }
  // Several people, the first of them the lead — same rule as the board's.
  const picked = formData.has('assignees') ? formData.getAll('assignees').map(String) : null;
  const lead = picked?.find((id) => id.trim() !== '') ?? null;

  const parsed = taskInputSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    priority: formData.get('priority') ?? 'P2',
    status: formData.get('status') ?? 'open',
    dueDate: formData.get('dueDate'),
    startDate: formData.get('startDate'),
    nextStep: formData.get('nextStep'),
    nextStepDate: formData.get('nextStepDate'),
    deptId: formData.get('deptId'),
    ownerPersonId: lead ?? formData.get('ownerPersonId'),
    parentId: formData.get('parentId'),
    tags: parseTags(formData.get('tags')),
    moneyImpactCents: parseMoney(formData.get('moneyImpact')),
    recurrenceRule: formData.get('recurrenceRule'),
    source: formData.get('source') ?? 'manual',
  });
  if (!parsed.success) return fromZod(parsed.error);

  const task = await createTask(parsed.data, user.email);

  // Everyone the form put on it, and the first of them as the lead.
  if (picked) {
    const lead = await setAssignees(task.id, picked);
    if (lead !== parsed.data.ownerPersonId) {
      await updateTask({ id: task.id, ownerPersonId: lead }, user.email);
    }
    const told = await notifyAssigned(
      task.id,
      picked.filter((id) => id.trim() !== ''),
      user.email,
      { sender: await senderIdentity(user.email) },
    ).catch(() => []);
    const failed = told.filter((t) => !t.ok);
    if (failed.length > 0) {
      return {
        ok: true,
        id: task.id,
        notice: `Saved. Slack did not reach everyone — ${failed
          .map((f) =>
            f.error === 'no_slack_id' ? `${f.name} has no Slack account on file` : `${f.name}: ${f.error}`,
          )
          .join('; ')}.`,
      };
    }
  }

  revalidatePath('/tasks');
  revalidatePath('/');
  return { ok: true, id: task.id };
}

export async function updateTaskAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const raw: Record<string, unknown> = { id: formData.get('id') };
  // Only send the fields the form actually submitted; everything else keeps its value.
  for (const key of ['title', 'description', 'priority', 'status', 'dueDate', 'startDate', 'nextStep', 'nextStepDate', 'deptId', 'ownerPersonId', 'recurrenceRule'] as const) {
    if (formData.has(key)) raw[key] = formData.get(key);
  }
  if (formData.has('tags')) raw.tags = parseTags(formData.get('tags'));
  if (formData.has('moneyImpact')) raw.moneyImpactCents = parseMoney(formData.get('moneyImpact'));

  /*
   * Several people on one task.
   *
   * The multi-select posts every name it has ticked, and the first of them is
   * the lead — the one the row groups under and the one heat scoring reads. It
   * is folded into the patch rather than written afterwards so that both write
   * paths below set and pin it the same way: a mirrored task whose owner is
   * written outside the patch would have its lead reverted by the next poll.
   */
  const picked = formData.has('assignees') ? formData.getAll('assignees').map(String) : null;
  if (picked) raw.ownerPersonId = picked.find((id) => id.trim() !== '') ?? '';

  const parsed = taskPatchSchema.safeParse(raw);
  if (!parsed.success) return fromZod(parsed.error);

  const gate = await forEdit(user, parsed.data.id);
  if (gate.error) return gate.error;

  /*
   * Whoever he has just put on it is told in Slack, and only them.
   *
   * Who was already on it is read BEFORE the write, because "new" is the
   * difference between the two — re-saving a task or moving its due date must
   * not send the same hand-over again to somebody who has had it a week. That
   * is how a message people read becomes a message people mute.
   */
  let newcomers: string[] = [];
  if (picked) {
    const before = new Set((await assigneesOf(parsed.data.id)).map((p) => p.id));
    await setAssignees(parsed.data.id, picked);
    newcomers = picked.filter((id) => id.trim() !== '' && !before.has(id));
  }

  /*
   * Nearly every task on his board is mirrored from ClickUp, and until now an
   * edit to one had to be accepted by ClickUp before it was kept here. It does
   * not any more — he does not work in ClickUp — so the mirrored path saves
   * the edit and only TELLS ClickUp, reporting back when it would not listen.
   */
  let notice: string | undefined;
  if (gate.task.layer === 'company') {
    const { id, ...patch } = parsed.data;
    const pushed = await editMirroredTask(id, patch, user.email);
    if (!pushed.ok) return { ok: false, error: pushed.error };
    if (pushed.clickupError) notice = pushed.clickupError;
  } else {
    try {
      await updateTask(parsed.data, user.email);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Update failed' };
    }
  }
  // Which pillars it belongs to, when the form carried the picker. A form
  // without it leaves the tags alone rather than clearing them — the quick
  // editors do not show the picker, and a save from one must not silently
  // untag the task.
  if (formData.has('lines')) {
    await setLines('task', parsed.data.id, formData.getAll('lines').map(String), user.email);
  }

  // After the write, so the message describes the task as it now is — the due
  // date he set in the same save is in it.
  if (newcomers.length > 0) {
    const told = await notifyAssigned(parsed.data.id, newcomers, user.email, {
      sender: await senderIdentity(user.email),
    }).catch(() => []);
    const failed = told.filter((t) => !t.ok);
    if (failed.length > 0) {
      const explain = failed
        .map((f) =>
          f.error === 'no_slack_id' ? `${f.name} has no Slack account on file` : `${f.name}: ${f.error}`,
        )
        .join('; ');
      notice = notice ? `${notice} ${explain}` : `Saved. Slack did not reach everyone — ${explain}.`;
    }
  }

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${parsed.data.id}`);
  revalidatePath('/');
  return { ok: true, id: parsed.data.id, ...(notice ? { notice } : {}) };
}

const idSchema = z.object({ id: z.string().uuid() });

export async function completeTaskAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return fromZod(parsed.error);
  const denied = await mayEdit(user, parsed.data.id);
  if (denied) return denied;
  try {
    await completeTask(parsed.data.id, user.email);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Closing the task failed' };
  }
  revalidatePath('/tasks');
  revalidatePath('/');
  return { ok: true };
}

const snoozeSchema = idSchema.extend({ days: z.coerce.number().int().min(1).max(90).default(7) });

export async function snoozeTaskAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = snoozeSchema.safeParse({ id: formData.get('id'), days: formData.get('days') });
  if (!parsed.success) return fromZod(parsed.error);
  const denied = await mayEdit(user, parsed.data.id);
  if (denied) return denied;
  try {
    await snoozeTask(parsed.data.id, addDays(new Date(), parsed.data.days), user.email);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Snoozing failed' };
  }
  revalidatePath('/tasks');
  revalidatePath('/');
  return { ok: true };
}

export async function archiveTaskAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return fromZod(parsed.error);
  const denied = await mayEdit(user, parsed.data.id);
  if (denied) return denied;
  try {
    await archiveTask(parsed.data.id, user.email);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Archiving failed' };
  }
  revalidatePath('/tasks');
  revalidatePath('/');
  return { ok: true };
}

export async function addCommentAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = commentInputSchema.safeParse({
    taskId: formData.get('taskId'),
    body: formData.get('body'),
  });
  if (!parsed.success) return fromZod(parsed.error);
  const denied = await mayEdit(user, parsed.data.taskId);
  if (denied) return denied;
  await addComment(parsed.data.taskId, parsed.data.body, user.email);
  revalidatePath(`/tasks/${parsed.data.taskId}`);
  return { ok: true };
}

/**
 * One task, in the shape the editor wants.
 *
 * The strips on the home screen carry four fields per row, which is right for
 * scanning and useless for editing. Rather than widening every query that
 * feeds them, the editor asks for the task when he opens it — one row, once,
 * and only when he actually wants to change something.
 */
export async function taskForEditAction(id: string) {
  const user = await requireUser();
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false as const, error: 'Not a task' };

  /*
   * The editor loads a task by id, so it is a way in of its own. Without this
   * it would hand a collaborator the whole of a private task to fill a form
   * they could never have opened from the list.
   */
  const denied = await mayEdit(user, parsed.data);
  if (denied) return { ok: false as const, error: denied.error ?? 'No such task' };

  const task = await getTask(parsed.data, canSeePrivate(user));
  if (!task) return { ok: false as const, error: 'No such task' };

  return {
    ok: true as const,
    task: {
      id: task.id,
      layer: task.layer,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      dueDate: task.dueDate,
      startDate: task.startDate,
      nextStep: task.nextStep,
      nextStepDate: task.nextStepDate,
      recurrenceRule: task.recurrenceRule,
      deptId: task.deptId,
      ownerPersonId: task.ownerPersonId,
      tags: task.tags,
      moneyImpactCents: task.moneyImpactCents,
    },
  };
}
