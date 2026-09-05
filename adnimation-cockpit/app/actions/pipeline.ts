'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { setLines } from '@/lib/control/tagging';
import { closeDeal, logTouch, setIntegrationStep, upsertPipelineClient } from '@/lib/pipeline/service';
import { CLOSE_OUTCOMES } from '@/lib/pipeline/integration';
import type { PipelineInput } from '@/lib/pipeline/types';

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  id?: string;
}

function fromZod(error: z.ZodError): ActionResult {
  const flat = error.flatten();
  return {
    ok: false,
    error: flat.formErrors[0] ?? 'The submitted data is not valid',
    fieldErrors: flat.fieldErrors as Record<string, string[]>,
  };
}

const asString = (v: FormDataEntryValue | null): string => String(v ?? '').trim();

/** Deal value is entered in dollars and stored in cents (CLAUDE.md §10). */
const parseMoney = (raw: FormDataEntryValue | null): number | null => {
  const s = asString(raw);
  if (!s) return null;
  const dollars = Number(s);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
};

export async function savePipelineClientAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = asString(formData.get('id')) || undefined;

  const input = {
    name: asString(formData.get('name')),
    domain: asString(formData.get('domain')),
    clientType: (asString(formData.get('clientType')) || 'other') as PipelineInput['clientType'],
    stage: (asString(formData.get('stage')) || 'open_new') as PipelineInput['stage'],
    temperature: (asString(formData.get('temperature')) || 'warm') as PipelineInput['temperature'],
    ownerPersonId: asString(formData.get('ownerPersonId')),
    nextStep: asString(formData.get('nextStep')),
    nextStepDate: asString(formData.get('nextStepDate')),
    valueCents: parseMoney(formData.get('value')),
    probability: asString(formData.get('probability')),
    source: asString(formData.get('source')),
    notes: asString(formData.get('notes')),
    hubspotCompanyId: asString(formData.get('hubspotCompanyId')),
  } satisfies PipelineInput;

  try {
    const saved = await upsertPipelineClient({ ...input, id }, user.email);
    // The pillars it belongs to, when the form carried the picker. A form
    // without it leaves the tags alone rather than clearing them.
    if (formData.has('lines')) {
      await setLines('deal', saved, formData.getAll('lines').map(String), user.email);
    }
    revalidatePath('/pipeline');
    revalidatePath('/');
    return { ok: true, id: saved };
  } catch (e) {
    if (e instanceof z.ZodError) return fromZod(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save the client' };
  }
}

export async function logTouchAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await logTouch(
      {
        clientId: asString(formData.get('clientId')),
        kind: asString(formData.get('kind')),
        summary: asString(formData.get('summary')),
      },
      user.email,
    );
    revalidatePath('/pipeline');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return fromZod(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Could not log the conversation' };
  }
}


const refresh = () => {
  revalidatePath('/pipeline');
  revalidatePath('/');
  revalidatePath('/copilot');
};

/** Tick an integration step, or say who it is waiting on. */
export async function setIntegrationStepAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({
      clientId: z.string().uuid(),
      key: z.string().trim().min(1).max(40),
      done: z.boolean().optional(),
      note: z.string().trim().max(500).optional(),
      blockedOn: z.string().trim().max(200).optional(),
    })
    .safeParse({
      clientId: asString(formData.get('clientId')),
      key: asString(formData.get('key')),
      ...(formData.has('done') ? { done: asString(formData.get('done')) === '1' } : {}),
      ...(formData.has('note') ? { note: asString(formData.get('note')) } : {}),
      ...(formData.has('blockedOn') ? { blockedOn: asString(formData.get('blockedOn')) } : {}),
    });
  if (!parsed.success) return fromZod(parsed.error);

  const { clientId, key, ...patch } = parsed.data;
  const result = await setIntegrationStep(clientId, key, patch, user.email);
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true, id: clientId };
}

/**
 * Close a deal, or put it back.
 *
 * Closing is always his call. The board says a deal *looks* finished and
 * offers the button; nothing here ever decides on its own.
 */
export async function closeDealAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({
      clientId: z.string().uuid(),
      outcome: z.enum(CLOSE_OUTCOMES),
      note: z.string().trim().max(2000).optional(),
      reopen: z.boolean().optional(),
    })
    .safeParse({
      clientId: asString(formData.get('clientId')),
      outcome: asString(formData.get('outcome')) || 'won',
      note: asString(formData.get('note')) || undefined,
      reopen: asString(formData.get('reopen')) === '1',
    });
  if (!parsed.success) return fromZod(parsed.error);

  const { clientId, ...input } = parsed.data;
  const result = await closeDeal(clientId, input, user.email);
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true, id: clientId };
}
