'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import {
  archiveContract, classifyContract, fileContract, setWaitingOn, suggestLinks,
} from '@/lib/contracts/intake-module';
import { CONTRACT_STATUSES } from '@/lib/contracts/status';

/**
 * What the contracts board can do.
 *
 * Classifying is the one that matters: saying what a contract is also decides
 * where it lives, so it files in the same step and there is no separate
 * "now file it" to forget.
 */

const CATEGORIES = ['demand', 'supply', 'mutual', 'quote', 'general'] as const;

function refresh() {
  revalidatePath('/contracts');
  revalidatePath('/pipeline');
  revalidatePath('/');
}

export interface ContractActionResult {
  ok: boolean;
  error?: string;
  warning?: string;
}

export async function classifyAction(formData: FormData): Promise<ContractActionResult> {
  const user = await requireUser();

  const emptyToNull = (v: FormDataEntryValue | null) => {
    const s = v === null ? '' : String(v).trim();
    return s === '' ? null : s;
  };

  const parsed = z
    .object({
      id: z.string().uuid(),
      counterpartyName: z.string().trim().min(1, 'It needs a counterparty').max(200),
      category: z.enum(CATEGORIES),
      docType: z.string().trim().max(200).optional(),
      status: z.enum(CONTRACT_STATUSES),
      notes: z.string().trim().max(4000).nullable(),
      opportunityId: z.string().uuid().nullable(),
      pipelineClientId: z.string().uuid().nullable(),
    })
    .safeParse({
      id: String(formData.get('id') ?? ''),
      counterpartyName: String(formData.get('counterpartyName') ?? ''),
      category: String(formData.get('category') ?? ''),
      docType: String(formData.get('docType') ?? '') || undefined,
      status: String(formData.get('status') ?? ''),
      notes: emptyToNull(formData.get('notes')),
      opportunityId: emptyToNull(formData.get('opportunityId')),
      pipelineClientId: emptyToNull(formData.get('pipelineClientId')),
    });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Could not save it' };
  }

  const result = await classifyContract(
    parsed.data.id,
    {
      counterpartyName: parsed.data.counterpartyName,
      category: parsed.data.category,
      ...(parsed.data.docType ? { docType: parsed.data.docType } : {}),
      status: parsed.data.status,
      notes: parsed.data.notes,
      opportunityId: parsed.data.opportunityId,
      pipelineClientId: parsed.data.pipelineClientId,
    },
    user.email,
  );

  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true, ...(result.warning ? { warning: result.warning } : {}) };
}

export async function setContractStatusAction(
  formData: FormData,
): Promise<ContractActionResult> {
  const user = await requireUser();

  const parsed = z
    .object({ id: z.string().uuid(), status: z.enum(CONTRACT_STATUSES) })
    .safeParse({
      id: String(formData.get('id') ?? ''),
      status: String(formData.get('status') ?? ''),
    });
  if (!parsed.success) return { ok: false, error: 'Not a status' };

  const result = await classifyContract(
    parsed.data.id,
    { status: parsed.data.status },
    user.email,
  );
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true, ...(result.warning ? { warning: result.warning } : {}) };
}

/**
 * Flip whose move it is.
 *
 * Sending it back with changes and waiting for a signature are both "with
 * them" and only one of them is a status, so this is a control of its own
 * rather than another status to pick.
 */
export async function setWaitingOnAction(formData: FormData): Promise<ContractActionResult> {
  await requireUser();

  const parsed = z
    .object({ id: z.string().uuid(), who: z.enum(['you', 'them', 'auto']) })
    .safeParse({
      id: String(formData.get('id') ?? ''),
      who: String(formData.get('who') ?? ''),
    });
  if (!parsed.success) return { ok: false, error: 'Not a valid choice' };

  const result = await setWaitingOn(
    parsed.data.id,
    parsed.data.who === 'auto' ? null : parsed.data.who,
  );
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true };
}

export async function refileAction(formData: FormData): Promise<ContractActionResult> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not a contract' };

  const result = await fileContract(id.data, user.email);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function archiveContractAction(formData: FormData): Promise<ContractActionResult> {
  await requireUser();
  const id = z.string().uuid().safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not a contract' };

  const result = await archiveContract(id.data);
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true };
}

/** Candidates to link a contract to, matched on the counterparty. */
export async function suggestLinksAction(counterparty: string) {
  await requireUser();
  return suggestLinks(counterparty);
}
