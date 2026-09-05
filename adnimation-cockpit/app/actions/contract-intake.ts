'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { contracts, db } from '@/lib/db';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { setLines } from '@/lib/control/tagging';
import {
  archiveContract, classifyContract, createLinkTarget, fileContract, setContractLink, setWaitingOn,
  suggestLinks,
  undoLastChange,
} from '@/lib/contracts/intake-module';
import { CONTRACT_STATUSES } from '@/lib/contracts/status';
import { summariseContract } from '@/lib/contracts/summarise';
import { redlineContract, rememberPosition, rewordClause } from '@/lib/contracts/redline';

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
      opportunityId: z.string().uuid().nullable().optional(),
      pipelineClientId: z.string().uuid().nullable().optional(),
    })
    .safeParse({
      id: String(formData.get('id') ?? ''),
      counterpartyName: String(formData.get('counterpartyName') ?? ''),
      category: String(formData.get('category') ?? ''),
      docType: String(formData.get('docType') ?? '') || undefined,
      status: String(formData.get('status') ?? ''),
      notes: emptyToNull(formData.get('notes')),
      /*
       * A link is only touched when the form actually carried its field.
       *
       * It used to send null for both whatever the form contained, and
       * classifyContract reads null as "unlink" — so saving this form wiped
       * the opportunity link every single time (the form has no field for it
       * at all) and wiped a deal link that had just been created from inside
       * the open editor, because the select still held the "— none —" it was
       * rendered with. The deal was made, the connection was thrown away, and
       * the contract still read "no deal".
       */
      ...(formData.has('opportunityId')
        ? { opportunityId: emptyToNull(formData.get('opportunityId')) }
        : {}),
      ...(formData.has('pipelineClientId')
        ? { pipelineClientId: emptyToNull(formData.get('pipelineClientId')) }
        : {}),
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
      ...(parsed.data.opportunityId !== undefined ? { opportunityId: parsed.data.opportunityId } : {}),
      ...(parsed.data.pipelineClientId !== undefined
        ? { pipelineClientId: parsed.data.pipelineClientId }
        : {}),
    },
    user.email,
  );

  if (!result.ok) return { ok: false, error: result.error };

  // The pillars it belongs to, when the form carried the picker. A form
  // without it leaves the tags alone rather than clearing them.
  if (formData.has('lines')) {
    await setLines('contract', parsed.data.id, formData.getAll('lines').map(String), user.email);
  }

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
  const user = await requireUser();

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
    user.email,
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
  const user = await requireUser();
  const id = z.string().uuid().safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not a contract' };

  const result = await archiveContract(id.data, user.email);
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true };
}

/**
 * Put a contract back the way it was before the last change.
 *
 * Every control on the card is a single click and several of them move files
 * in Drive. An accidental click has to be recoverable.
 */
export async function undoAction(formData: FormData): Promise<ContractActionResult> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { ok: false, error: 'Not a contract' };

  const result = await undoLastChange(id.data, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true, warning: `Undid: ${result.restored}` };
}

/**
 * Create the opportunity or the deal this contract belongs to, and link it.
 *
 * Often the contract is the first record of the relationship, so requiring the
 * other record to exist first is requiring him to leave the screen and come
 * back — which is how contracts end up linked to nothing.
 */
export async function createLinkAction(
  formData: FormData,
): Promise<ContractActionResult & { id?: string }> {
  const user = await requireUser();

  const parsed = z
    .object({ id: z.string().uuid(), what: z.enum(['opportunity', 'deal']) })
    .safeParse({
      id: String(formData.get('id') ?? ''),
      what: String(formData.get('what') ?? ''),
    });
  if (!parsed.success) return { ok: false, error: 'Not a valid choice' };

  const result = await createLinkTarget(parsed.data.id, parsed.data.what, user.email);
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return {
    ok: true,
    id: result.id,
    warning:
      parsed.data.what === 'opportunity'
        ? 'Opportunity created and linked.'
        : 'Deal created in the pipeline and linked.',
  };
}

/**
 * Read the contract and say what it commits us to.
 *
 * Not persisted: a summary is a reading aid, and a stale one describing an
 * older version is worse than none. It is regenerated on demand — against the
 * newest version in Drive, or against one named document, because a contract
 * is often several files and the question is usually about one of them.
 */
export async function summariseAction(contractId: string, versionId?: string) {
  await requireUser();
  const parsed = z.string().uuid().safeParse(contractId);
  if (!parsed.success) return { ok: false as const, error: 'Not a contract' };

  const version = versionId ? z.string().uuid().safeParse(versionId) : null;
  if (version && !version.success) return { ok: false as const, error: 'Not a document' };

  return summariseContract(parsed.data, version?.data);
}

/** Candidates to link a contract to, matched on the counterparty. */
export async function suggestLinksAction(counterparty: string) {
  await requireUser();
  return suggestLinks(counterparty);
}

/**
 * Prepare the reply to a contract: what to change, and the covering email.
 *
 * Per document, because an email often carries three at once and each is
 * answered on its own terms. Nothing is sent and nothing is rewritten — §6.1
 * makes sending an external document irreversible, so the send stays a click
 * he makes with the draft in front of him.
 */
export async function redlineAction(contractId: string, versionId?: string) {
  await requireUser();
  const parsed = z.string().uuid().safeParse(contractId);
  if (!parsed.success) return { ok: false as const, error: 'Not a contract' };

  const version = versionId ? z.string().uuid().safeParse(versionId) : null;
  if (version && !version.success) return { ok: false as const, error: 'Not a document' };

  return redlineContract(parsed.data, version?.data);
}

/** Redraft one clause the way he just said it should read. */
export async function rewordAction(input: {
  contractId: string;
  clause: string;
  original: string;
  currentProposal: string;
  instruction: string;
}) {
  await requireUser();

  const parsed = z
    .object({
      contractId: z.string().uuid(),
      clause: z.string().trim().max(300),
      original: z.string().trim().max(20_000),
      currentProposal: z.string().trim().max(20_000),
      instruction: z.string().trim().min(2, 'Say what to change').max(2000),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.flatten().formErrors[0] ?? 'Not a change' };
  }

  const [contract] = await db
    .select({ counterpartyName: contracts.counterpartyName })
    .from(contracts)
    .where(eq(contracts.id, parsed.data.contractId))
    .limit(1);
  if (!contract) return { ok: false as const, error: 'No such contract' };

  return rewordClause({ ...parsed.data, counterparty: contract.counterpartyName });
}

/**
 * Keep a position he has just taken, so the next contract arrives with it
 * already applied. It goes into the redliner agent's brief — the one place
 * that teaches both this button and the agent.
 */
export async function rememberPositionAction(formData: FormData) {
  const user = await requireUser();
  const position = String(formData.get('position') ?? '');
  const result = await rememberPosition(position, user.email);
  if (!result.ok) return { ok: false as const, error: result.error };

  revalidatePath('/agents');
  return { ok: true as const, message: 'Saved. The next contract will start from it.' };
}

/** Link a contract to an opportunity or a deal, without opening the editor. */
export async function setLinkAction(formData: FormData): Promise<ContractActionResult> {
  const user = await requireUser();

  const parsed = z
    .object({
      id: z.string().uuid(),
      what: z.enum(['opportunity', 'deal']),
      target: z.string().uuid().nullable(),
    })
    .safeParse({
      id: String(formData.get('id') ?? ''),
      what: String(formData.get('what') ?? ''),
      target: String(formData.get('target') ?? '').trim() || null,
    });
  if (!parsed.success) return { ok: false, error: 'Not a link' };

  const result = await setContractLink(
    parsed.data.id,
    parsed.data.what === 'opportunity'
      ? { opportunityId: parsed.data.target }
      : { pipelineClientId: parsed.data.target },
    user.email,
  );
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/contracts');
  revalidatePath('/opportunities');
  revalidatePath('/pipeline');
  return { ok: true, warning: parsed.data.target ? undefined : 'Unlinked.' };
}
