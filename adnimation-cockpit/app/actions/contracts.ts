'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { confirmCategory, createContract, setContractStatus } from '@/lib/contracts/service';
import { CONTRACT_STATUSES } from '@/lib/contracts/status';

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

/** Contract value is entered in dollars and stored in cents (CLAUDE.md §10). */
const parseMoney = (raw: FormDataEntryValue | null): number | null => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const dollars = Number(s);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
};

const asString = (v: FormDataEntryValue | null): string => String(v ?? '').trim();

export async function createContractAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  try {
    const id = await createContract(
      {
        counterparty: asString(formData.get('counterparty')),
        category: asString(formData.get('category')) as 'demand' | 'supply' | 'general',
        // Entered by a person, so it is confirmed by definition. Only the
        // classifier files a contract it has not been told the category for.
        categoryConfirmed: true,
        docType: asString(formData.get('docType')),
        status: (asString(formData.get('status')) ||
          'draft') as (typeof CONTRACT_STATUSES)[number],
        deptId: asString(formData.get('deptId')),
        startDate: asString(formData.get('startDate')),
        endDate: asString(formData.get('endDate')),
        renewal: asString(formData.get('renewal')),
        noticePeriodDays: asString(formData.get('noticePeriodDays')),
        valueCents: parseMoney(formData.get('value')),
        legalOwner: asString(formData.get('legalOwner')),
      },
      user.email,
    );

    revalidatePath('/contracts');
    revalidatePath('/');
    return { ok: true, id };
  } catch (e) {
    if (e instanceof z.ZodError) return fromZod(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save the contract' };
  }
}

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(CONTRACT_STATUSES),
});

export async function setContractStatusAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = statusSchema.safeParse({
    id: formData.get('id'),
    status: formData.get('status'),
  });
  if (!parsed.success) return fromZod(parsed.error);

  try {
    await setContractStatus(parsed.data.id, parsed.data.status, user.email);
    revalidatePath('/contracts');
    revalidatePath('/');
    return { ok: true, id: parsed.data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not move the contract' };
  }
}

const categorySchema = z.object({
  id: z.string().uuid(),
  category: z.enum(['demand', 'supply', 'general']),
});

export async function confirmCategoryAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = categorySchema.safeParse({
    id: formData.get('id'),
    category: formData.get('category'),
  });
  if (!parsed.success) return fromZod(parsed.error);

  try {
    await confirmCategory(parsed.data.id, parsed.data.category, user.email);
    revalidatePath('/contracts');
    revalidatePath('/');
    return { ok: true, id: parsed.data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not confirm the filing' };
  }
}
