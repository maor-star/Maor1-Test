'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import {
  archiveOpportunity, captureMailThread, contractsForOpportunities, createOpportunity,
  decideSuggestion, getOpportunity,
  promoteToPipeline, setOpportunityStatus, suggestFromMail, updateOpportunity,
} from '@/lib/opportunities/module';
import { captureSlackPermalink } from '@/lib/opportunities/slack-capture';
import { OPPORTUNITY_STATUSES, opportunityInputSchema } from '@/lib/opportunities/rules';

/**
 * Everything the opportunities screen can do.
 *
 * Nothing here deletes: archiving hides a row, and a missed opportunity is
 * kept rather than removed — a record of what he passed on is the only way to
 * ever learn whether he passes on the right things.
 */

function refresh() {
  revalidatePath('/opportunities');
  revalidatePath('/');
}

/** Pull the form's fields out of the FormData the schema expects. */
function readForm(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return v === null ? undefined : String(v);
  };
  return {
    title: get('title') ?? '',
    kind: get('kind') || 'other',
    status: get('status') || 'new',
    note: get('note'),
    counterparty: get('counterparty'),
    valueCents: get('value'),
    nextStep: get('nextStep'),
    nextStepDate: get('nextStepDate'),
    revisitOn: get('revisitOn'),
    source: get('source') || 'manual',
    sourceUrl: get('sourceUrl'),
    sourceExcerpt: get('sourceExcerpt'),
  };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  warning?: string;
  fieldErrors?: Record<string, string[]>;
}

export async function createOpportunityAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = opportunityInputSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const result = await createOpportunity(parsed.data, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true };
}

export async function updateOpportunityAction(formData: FormData): Promise<ActionResult> {
  await requireUser();

  const id = z.string().uuid().safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not an opportunity' };

  const parsed = opportunityInputSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const result = await updateOpportunity(id.data, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true };
}

export async function setStatusAction(formData: FormData): Promise<ActionResult> {
  await requireUser();

  const parsed = z
    .object({
      id: z.string().uuid(),
      status: z.enum(OPPORTUNITY_STATUSES),
      note: z.string().trim().max(2000).optional(),
    })
    .safeParse({
      id: String(formData.get('id') ?? ''),
      status: String(formData.get('status') ?? ''),
      note: String(formData.get('decidedNote') ?? '') || undefined,
    });
  if (!parsed.success) return { ok: false, error: 'Not a status' };

  const result = await setOpportunityStatus(parsed.data.id, parsed.data.status, parsed.data.note);
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true };
}

export async function archiveOpportunityAction(formData: FormData): Promise<ActionResult> {
  await requireUser();

  const id = z.string().uuid().safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not an opportunity' };

  const result = await archiveOpportunity(id.data);
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true };
}

export async function decideSuggestionAction(formData: FormData): Promise<ActionResult> {
  await requireUser();

  const parsed = z
    .object({ id: z.string().uuid(), accept: z.boolean() })
    .safeParse({
      id: String(formData.get('id') ?? ''),
      accept: String(formData.get('accept') ?? '') === '1',
    });
  if (!parsed.success) return { ok: false, error: 'Not a suggestion' };

  const result = await decideSuggestion(parsed.data.id, parsed.data.accept);
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true };
}

/**
 * Move a matured opportunity into the pipeline.
 *
 * Revalidates both screens: the deal has to appear in one and the opportunity
 * has to stop looking open in the other, or the two disagree until a reload.
 */
export async function promoteAction(
  formData: FormData,
): Promise<ActionResult & { clientId?: string }> {
  const user = await requireUser();

  const parsed = z
    .object({
      id: z.string().uuid(),
      stage: z.string().trim().max(40).optional(),
      clientType: z.string().trim().max(40).optional(),
    })
    .safeParse({
      id: String(formData.get('id') ?? ''),
      stage: String(formData.get('stage') ?? '') || undefined,
      clientType: String(formData.get('clientType') ?? '') || undefined,
    });
  if (!parsed.success) return { ok: false, error: 'Not an opportunity' };

  const result = await promoteToPipeline(parsed.data.id, user.email, {
    ...(parsed.data.stage ? { stage: parsed.data.stage } : {}),
    ...(parsed.data.clientType ? { clientType: parsed.data.clientType } : {}),
  });
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  revalidatePath('/pipeline');
  return { ok: true, clientId: result.clientId };
}

/** Capture a mail thread from the mail screen, in one click. */
export async function captureMailAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const threadId = z.string().min(1).max(80).safeParse(String(formData.get('threadId') ?? ''));
  if (!threadId.success) return { ok: false, error: 'Not a conversation' };

  const result = await captureMailThread(threadId.data, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  revalidatePath('/mail');
  return { ok: true };
}

export async function captureSlackAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = z
    .object({
      permalink: z.string().trim().min(1, 'Paste the Slack message link').max(1000),
      title: z.string().trim().max(300).optional(),
    })
    .safeParse({
      permalink: String(formData.get('permalink') ?? ''),
      title: String(formData.get('title') ?? '') || undefined,
    });
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const result = await captureSlackPermalink(parsed.data.permalink, user.email, {
    ...(parsed.data.title ? { title: parsed.data.title } : {}),
  });
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true, ...(result.warning ? { warning: result.warning } : {}) };
}

/** Sweep the mirrored mail for candidates, on demand. */
export async function sweepMailAction(): Promise<ActionResult & { proposed?: number }> {
  await requireUser();

  try {
    const { proposed, scanned } = await suggestFromMail();
    refresh();
    return {
      ok: true,
      warning:
        proposed === 0
          ? `Read ${scanned} recent conversations, nothing new worth proposing.`
          : `Proposed ${proposed} from ${scanned} conversations.`,
      proposed,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not scan the mail' };
  }
}

/**
 * One opportunity, whole.
 *
 * The home screen lists three fields of it; editing needs all of them. Asked
 * for when he opens the editor rather than carried by every strip that shows
 * a title.
 */
export async function opportunityForEditAction(id: string) {
  await requireUser();
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false as const, error: 'Not an opportunity' };

  const row = await getOpportunity(parsed.data);
  if (!row) return { ok: false as const, error: 'No such opportunity' };

  const linked = await contractsForOpportunities([row.id]);
  return { ok: true as const, opportunity: row, contracts: linked.get(row.id) ?? [] };
}
