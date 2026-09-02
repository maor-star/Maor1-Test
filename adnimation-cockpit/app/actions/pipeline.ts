'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { logTouch, upsertPipelineClient } from '@/lib/pipeline/service';
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
