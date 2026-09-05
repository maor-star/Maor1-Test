'use server';

import { revalidatePath } from 'next/cache';
import { addDays } from 'date-fns';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import {
  addComment, archiveTask, completeTask, createTask, snoozeTask, updateTask,
} from '@/lib/tasks/mutations';
import { commentInputSchema, taskInputSchema, taskPatchSchema } from '@/lib/tasks/types';
import { getTask } from '@/lib/tasks/queries';

export interface ActionResult {
  ok: boolean;
  error?: string;
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
    ownerPersonId: formData.get('ownerPersonId'),
    parentId: formData.get('parentId'),
    tags: parseTags(formData.get('tags')),
    moneyImpactCents: parseMoney(formData.get('moneyImpact')),
    recurrenceRule: formData.get('recurrenceRule'),
    source: formData.get('source') ?? 'manual',
  });
  if (!parsed.success) return fromZod(parsed.error);

  const task = await createTask(parsed.data, user.email);
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

  const parsed = taskPatchSchema.safeParse(raw);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    await updateTask(parsed.data, user.email);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
  revalidatePath('/tasks');
  revalidatePath(`/tasks/${parsed.data.id}`);
  revalidatePath('/');
  return { ok: true, id: parsed.data.id };
}

const idSchema = z.object({ id: z.string().uuid() });

export async function completeTaskAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return fromZod(parsed.error);
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
  await requireUser();
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false as const, error: 'Not a task' };

  const task = await getTask(parsed.data);
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
