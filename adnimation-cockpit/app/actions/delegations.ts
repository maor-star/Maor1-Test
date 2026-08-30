'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { checkForReplies } from '@/lib/delegation/replies';
import {
  archiveDelegation, createDelegation, nudgeDelegation, readConversation,
  replyToDelegation, setDelegationStatus, type NewDelegationInput,
} from '@/lib/delegation/module';
import type { ThreadMessage } from '@/lib/integrations/types';
import { TASK_PRIORITIES } from '@/lib/tasks/types';

/**
 * Everything the delegations screen does.
 *
 * Each of these ends in a real side effect in Slack, so each reports what
 * actually happened rather than a generic success — a hand-off that did not
 * reach anybody must not look the same as one that did.
 */

export interface ReplyCheckResult {
  ok: boolean;
  checked: number;
  found: number;
  error?: string;
}

/** Reads Slack and email for answers to what was handed off. */
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

export interface ActionResult {
  ok: boolean;
  error?: string;
  warning?: string;
  fieldErrors?: Record<string, string[]>;
}

const str = (v: FormDataEntryValue | null) => String(v ?? '').trim();

function refresh() {
  revalidatePath('/delegations');
  revalidatePath('/');
}

export async function createDelegationAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const input: NewDelegationInput = {
    delegatedTo: str(formData.get('delegatedTo')),
    title: str(formData.get('title')),
    note: str(formData.get('note')),
    dueDate: str(formData.get('dueDate')),
    priority: (str(formData.get('priority')) || 'P2') as (typeof TASK_PRIORITIES)[number],
    alsoClickUp: str(formData.get('alsoClickUp')) === '1',
  };

  try {
    const result = await createDelegation(input, user.email);
    refresh();

    // Recorded either way, but say plainly when it did not actually arrive.
    if (!result.slackOk) {
      return {
        ok: true,
        warning: `Recorded, but Slack did not accept it: ${result.slackError ?? 'unknown'}. Nobody has been told yet.`,
      };
    }
    if (input.alsoClickUp && !result.clickupOk) {
      return {
        ok: true,
        warning: `Sent on Slack, but the ClickUp task was not created: ${result.clickupError ?? 'unknown'}.`,
      };
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) {
      const flat = e.flatten();
      return {
        ok: false,
        error: flat.formErrors[0] ?? 'Check the form',
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      };
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Could not hand this over' };
  }
}

export async function readConversationAction(
  id: string,
): Promise<{ messages: ThreadMessage[]; error: string | null }> {
  await requireUser();
  return readConversation(id);
}

export async function replyAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = str(formData.get('id'));
  const text = str(formData.get('text'));
  if (!text) return { ok: false, error: 'Nothing to send' };

  const result = await replyToDelegation(id, text, user.email);
  if (result.ok) refresh();
  return result.ok ? { ok: true } : { ok: false, ...(result.error ? { error: result.error } : {}) };
}

export async function nudgeAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const result = await nudgeDelegation(
    str(formData.get('id')),
    user.email,
    str(formData.get('text')) || undefined,
  );
  if (result.ok) refresh();
  return result.ok ? { ok: true } : { ok: false, ...(result.error ? { error: result.error } : {}) };
}

export async function setStatusAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const result = await setDelegationStatus(
    str(formData.get('id')),
    str(formData.get('status')),
    user.email,
    str(formData.get('closedNote')) || undefined,
  );
  if (result.ok) refresh();
  return result.ok ? { ok: true } : { ok: false, ...(result.error ? { error: result.error } : {}) };
}

export async function archiveDelegationAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await archiveDelegation(str(formData.get('id')), user.email);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not archive it' };
  }
}
