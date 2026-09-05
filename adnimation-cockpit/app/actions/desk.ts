'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { collectDesk, deskItem } from '@/lib/copilot/desk';
import { draftForItem, markActed, saveDraft, type DeskDraft } from '@/lib/copilot/desk-draft';
import { draftIsCurrent, followUpHome, type DeskItem } from '@/lib/copilot/desk-rules';
import { replyToThread } from '@/lib/mail/send';
import { postToSlack } from '@/lib/copilot/slack-view';
import { dismissThread, taskFromThread } from '@/lib/mail/service';
import { createTask } from '@/lib/tasks/mutations';
import { logTouch } from '@/lib/pipeline/service';
import { delegate } from '@/lib/delegation/service';
import { createClickUpAdapter } from '@/lib/integrations/clickup';
import { createSlackAdapter } from '@/lib/integrations/slack';

/**
 * The desk's buttons.
 *
 * Every one of them does the thing AND records where the follow-up lives —
 * that is the whole difference between this screen and answering the mail in
 * Gmail. A reply sent from here leaves a task, a hand-over leaves a delegation
 * to chase, a move on a deal leaves a touch on that deal. Nothing is answered
 * and then dropped.
 *
 * Nothing leaves the company without his click. The drafting is automatic; the
 * sending never is (CLAUDE.md §6).
 */

const REVALIDATE = ['/copilot', '/', '/tasks', '/delegations', '/pipeline', '/mail'];
const refresh = () => REVALIDATE.forEach((p) => revalidatePath(p));

export interface DeskActionResult {
  ok: boolean;
  error?: string;
  /** What happened, in his words, for the line on the card. */
  did?: string;
  needsKey?: boolean;
}

/** One item, refetched — an action must never act on a card that has moved on. */
async function item(id: string): Promise<DeskItem | null> {
  return deskItem(id);
}

/** Draft one card's answer, or redraft it when the conversation has moved. */
export async function draftItemAction(
  itemId: string,
): Promise<{ ok: boolean; draft?: DeskDraft; error?: string; needsKey?: boolean }> {
  await requireUser();
  const found = await item(itemId);
  if (!found) return { ok: false, error: 'That is no longer on the desk' };

  const result = await draftForItem(found);
  if (!result.ok) {
    return { ok: false, error: result.error, ...(result.needsKey ? { needsKey: true } : {}) };
  }

  await saveDraft(found, result.draft);
  revalidatePath('/copilot');
  return { ok: true, draft: result.draft };
}

/**
 * Prepare everything that has no current answer.
 *
 * Bounded, because each one is a model call: the loudest ten, which is the
 * screenful he actually works through. The rest are one click each.
 */
export async function draftAllAction(): Promise<{
  ok: boolean;
  drafted: number;
  failed: number;
  error?: string;
  needsKey?: boolean;
}> {
  await requireUser();
  const { items } = await collectDesk();
  const { storedDrafts } = await import('@/lib/copilot/desk-draft');
  const stored = await storedDrafts();

  const missing = items
    .filter((i) => !draftIsCurrent(stored.get(i.id)?.fingerprint, i))
    .slice(0, 10);

  let drafted = 0;
  let failed = 0;
  let needsKey = false;
  let error: string | undefined;

  for (const one of missing) {
    const result = await draftForItem(one);
    if (result.ok) {
      await saveDraft(one, result.draft);
      drafted += 1;
    } else {
      failed += 1;
      error ??= result.error;
      // No key means every remaining call fails the same way — stop asking.
      if (result.needsKey) {
        needsKey = true;
        break;
      }
    }
  }

  refresh();
  return { ok: drafted > 0 || missing.length === 0, drafted, failed, ...(error ? { error } : {}), needsKey };
}

const sendSchema = z.object({
  itemId: z.string().min(1).max(200),
  text: z.string().trim().min(1, 'There is nothing to send').max(20_000),
});

/**
 * Send it: a mail reply, or a Slack message.
 *
 * The text is whatever is in the box when he presses the button — the draft as
 * written, or the draft as he changed it. What was drafted is not what is sent
 * unless he left it alone, which is the point of the box.
 */
export async function sendItemAction(formData: FormData): Promise<DeskActionResult> {
  const user = await requireUser();
  const parsed = sendSchema.safeParse({
    itemId: String(formData.get('itemId') ?? ''),
    text: String(formData.get('text') ?? ''),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Could not send it' };

  const found = await item(parsed.data.itemId);
  if (!found) return { ok: false, error: 'That is no longer on the desk' };

  if (found.channel === 'mail' && found.target) {
    const sent = await replyToThread(found.target, parsed.data.text);
    if (!sent.ok) return { ok: false, error: sent.error ?? 'Gmail refused it' };

    /*
     * Answered, so it is out of "waiting" — and it leaves a task only when the
     * reply promised something. A reply that closes a conversation should not
     * plant a task he has to close by hand.
     */
    await dismissThread(found.target, false, user.email);
    await markActed(found.id, 'replied');
    refresh();
    return { ok: true, did: `Replied to ${found.who} and marked the thread handled.` };
  }

  if ((found.channel === 'slack' || found.channel === 'delegation') && found.target) {
    const posted = await postToSlack(found.target, parsed.data.text);
    if (!posted.ok) return { ok: false, error: posted.error ?? 'Slack refused it' };
    await markActed(found.id, 'posted');
    refresh();
    return { ok: true, did: `Posted it in #${posted.channel}.` };
  }

  return { ok: false, error: 'There is nowhere to send this one — hand it over or keep it as a task.' };
}

const keepSchema = z.object({
  itemId: z.string().min(1).max(200),
  text: z.string().trim().max(20_000).optional(),
});

/**
 * Keep it: the decision, or the move, recorded where it will be seen again.
 *
 * A deal's move is logged as a touch on that deal, so the board stops calling
 * it quiet; everything else becomes a task of his, carrying what the copilot
 * suggested so he is not reading it cold in a week.
 */
export async function keepItemAction(formData: FormData): Promise<DeskActionResult> {
  const user = await requireUser();
  const parsed = keepSchema.safeParse({
    itemId: String(formData.get('itemId') ?? ''),
    text: String(formData.get('text') ?? ''),
  });
  if (!parsed.success) return { ok: false, error: 'Could not record it' };

  const found = await item(parsed.data.itemId);
  if (!found) return { ok: false, error: 'That is no longer on the desk' };
  const note = (parsed.data.text ?? '').trim();

  const home = followUpHome(found, false);

  if (home === 'deal' && found.entityId) {
    await logTouch(
      { clientId: found.entityId, kind: 'note', summary: note.slice(0, 500) || found.title },
      user.email,
    );
    await markActed(found.id, 'logged on the deal');
    refresh();
    return { ok: true, did: `Logged on the ${found.who} deal.` };
  }

  const task = await createTask(
    {
      title: `${found.who}: ${found.title}`.slice(0, 300),
      description: [note, found.context, found.url ?? ''].filter(Boolean).join('\n\n'),
      priority: 'P2',
      status: 'open',
      tags: [found.channel],
      blockedPeople: [],
      source: found.channel === 'mail' ? 'email' : 'manual',
      ...(found.channel === 'mail' && found.target ? { sourceRef: found.target } : {}),
    },
    user.email,
  );

  await markActed(found.id, 'kept as a task');
  refresh();
  return { ok: true, did: `Kept as a task: ${task.title}` };
}

const handSchema = z.object({
  itemId: z.string().min(1).max(200),
  personId: z.string().uuid('Pick who this is going to'),
  text: z.string().trim().max(5000).optional(),
});

/**
 * Hand it over.
 *
 * A delegation hangs off a record, so anything that is not one yet becomes one
 * first — a mail becomes the task it always was, and that task is what gets
 * handed over. Both side effects fire: the person hears about it in Slack, and
 * it lands in ClickUp where the team works.
 */
export async function handOverAction(formData: FormData): Promise<DeskActionResult> {
  const user = await requireUser();
  const parsed = handSchema.safeParse({
    itemId: String(formData.get('itemId') ?? ''),
    personId: String(formData.get('personId') ?? ''),
    text: String(formData.get('text') ?? ''),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Could not hand it over' };
  }

  const found = await item(parsed.data.itemId);
  if (!found) return { ok: false, error: 'That is no longer on the desk' };

  let sourceEntityType: 'task' | 'contract' | 'deal' = 'task';
  let sourceEntityId = found.entityId ?? '';

  if (found.entityType === 'contract') sourceEntityType = 'contract';
  else if (found.entityType === 'deal') sourceEntityType = 'deal';

  if (!sourceEntityId) {
    // Nothing to hang it off yet. A mail becomes the task it was always going
    // to become; anything else gets one made for it.
    if (found.channel === 'mail' && found.target) {
      const made = await taskFromThread(found.target, user.email);
      if (!made.ok) return { ok: false, error: made.error };
      sourceEntityId = made.id;
    } else {
      const made = await createTask(
        {
          title: `${found.who}: ${found.title}`.slice(0, 300),
          description: [found.context, found.url ?? ''].filter(Boolean).join('\n\n'),
          priority: 'P2',
          status: 'open',
          tags: [found.channel],
          blockedPeople: [],
          source: 'manual',
        },
        user.email,
      );
      sourceEntityId = made.id;
    }
    sourceEntityType = 'task';
  }

  const result = await delegate(
    {
      sourceEntityType,
      sourceEntityId,
      delegatedTo: parsed.data.personId,
      title: `${found.who}: ${found.title}`.slice(0, 300),
      note: (parsed.data.text ?? '').trim() || found.context,
      priority: 'P2',
      clickupListId: process.env.CLICKUP_DEFAULT_LIST_ID ?? '',
      ...(found.url && /^https?:/.test(found.url) ? { backlinkUrl: found.url } : {}),
    },
    { slack: createSlackAdapter(), clickup: createClickUpAdapter(), actor: user.email },
  );

  await markActed(found.id, 'handed over');
  refresh();

  if (!result.slack.ok || !result.clickup.ok) {
    const failed = [
      result.slack.ok ? null : `Slack (${result.slack.error})`,
      result.clickup.ok ? null : `ClickUp (${result.clickup.error})`,
    ].filter(Boolean);
    return {
      ok: true,
      did: `Handed over and being tracked — but delivery failed for: ${failed.join(', ')}`,
    };
  }

  return { ok: true, did: 'Handed over. It is in the delegation tracker now.' };
}

/** Not now: off the desk, nothing sent, nothing filed. */
export async function skipItemAction(itemId: string): Promise<DeskActionResult> {
  await requireUser();
  const found = await item(itemId);
  if (!found) return { ok: false, error: 'That is no longer on the desk' };

  if (found.channel === 'mail' && found.target) {
    // The mail mirror already has a word for this, and it clears itself the
    // moment he answers in Gmail — so skipping here can never hide a live
    // conversation.
    const user = await requireUser();
    await dismissThread(found.target, false, user.email);
  }
  await markActed(found.id, 'skipped');
  refresh();
  return { ok: true, did: 'Off the desk.' };
}
