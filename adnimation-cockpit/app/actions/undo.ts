'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { lastUndoableFor, undoAudit } from '@/lib/undo';

/**
 * Undo, as the screen uses it.
 *
 * Two calls, and neither asks the caller what it just did. A component that
 * changed something says "something happened" and gets back the change to
 * offer; clicking the button sends that change back. Nothing here is specific
 * to tasks or contracts or deals, which is the point — undo arrives with the
 * audit row, so it covers every action that writes one and cannot be forgotten
 * on the next screen somebody builds.
 *
 * The ten seconds are the bar's, not the server's. A request that arrives late
 * is still a legitimate correction; refusing it on a stopwatch would only mean
 * making the same change again by hand.
 */

/** What the bar says it will put back. Falls back to the raw action name. */
const PHRASES: Record<string, string> = {
  'task.update': 'Task edited',
  'task.complete': 'Task closed',
  'task.snooze': 'Task snoozed',
  'task.archive': 'Task archived',
  'task.clickup_edit': 'ClickUp task edited',
  'task.clickup_detach': 'Task detached from ClickUp',
  'opportunity.update': 'Opportunity edited',
  'opportunity.status': 'Opportunity status changed',
  'opportunity.archive': 'Opportunity archived',
  'contract.status': 'Contract status changed',
  'contract.confirm_category': 'Contract filed under a category',
  'contract.link': 'Contract link changed',
  'contract.archive': 'Contract archived',
  'pipeline.update': 'Deal edited',
  'crm.contact.update': 'Contact edited',
  'crm.contact.archive': 'Contact archived',
  'crm.contact.restore': 'Contact restored',
  'mail.dismiss': 'Conversation marked handled',
  'mail.restore': 'Conversation put back',
  'delegation.archive': 'Delegation archived',
};

const phraseFor = (action: string) =>
  PHRASES[action] ?? (action.endsWith('.undo') ? 'Undo' : action.replace(/[._]/g, ' '));

export interface UndoOfferResult {
  /** Null when the last thing that happened cannot be put back automatically. */
  offer: { auditId: number; label: string } | null;
}

export async function lastUndoableAction(): Promise<UndoOfferResult> {
  const user = await requireUser();
  const found = await lastUndoableFor(user.email);
  return {
    offer: found ? { auditId: found.auditId, label: phraseFor(found.action) } : null,
  };
}

export interface UndoActionResult {
  ok: boolean;
  error?: string;
}

export async function undoAction(auditId: number): Promise<UndoActionResult> {
  const user = await requireUser();
  const parsed = z.number().int().positive().safeParse(auditId);
  if (!parsed.success) return { ok: false, error: 'There is nothing to undo' };

  const result = await undoAudit(parsed.data, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  // Undo can land on any screen, and the row it put back may be shown on
  // several of them at once — the home strips, the list, the card.
  for (const path of ['/', '/tasks', '/opportunities', '/pipeline', '/contracts', '/crm', '/mail']) {
    revalidatePath(path);
  }
  return { ok: true };
}
