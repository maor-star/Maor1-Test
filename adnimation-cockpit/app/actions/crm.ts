'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import {
  archiveCompany, archiveContact, saveCompany, saveContact,
  type CompanyInput, type ContactInput,
} from '@/lib/crm/mutations';

/**
 * Writing to the CRM from the screen.
 *
 * HubSpot is being wound down, so these are the calls that make the cockpit the
 * place records actually live: add, edit, retire. Nothing here deletes, and
 * every write stamps the record as edited so no future sync can undo it.
 */

export interface CrmActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  id?: string;
}

function fromZod(error: z.ZodError): CrmActionResult {
  const flat = error.flatten();
  return {
    ok: false,
    error: flat.formErrors[0] ?? 'The submitted data is not valid',
    fieldErrors: flat.fieldErrors as Record<string, string[]>,
  };
}

const str = (v: FormDataEntryValue | null): string => String(v ?? '').trim();
const opt = (v: FormDataEntryValue | null): string | undefined => str(v) || undefined;

function refresh() {
  revalidatePath('/crm');
  revalidatePath('/');
}

export async function saveCompanyAction(formData: FormData): Promise<CrmActionResult> {
  const user = await requireUser();

  const input: CompanyInput = {
    id: opt(formData.get('id')),
    name: str(formData.get('name')),
    domain: str(formData.get('domain')),
    lifecycleStage: str(formData.get('lifecycleStage')),
    ownerName: str(formData.get('ownerName')),
    industry: str(formData.get('industry')),
    country: str(formData.get('country')),
    city: str(formData.get('city')),
    phone: str(formData.get('phone')),
    notes: str(formData.get('notes')),
  };

  try {
    const id = await saveCompany(input, user.email);
    refresh();
    return { ok: true, id };
  } catch (e) {
    if (e instanceof z.ZodError) return fromZod(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save the company' };
  }
}

export async function saveContactAction(formData: FormData): Promise<CrmActionResult> {
  const user = await requireUser();

  const input: ContactInput = {
    id: opt(formData.get('id')),
    firstName: str(formData.get('firstName')),
    lastName: str(formData.get('lastName')),
    email: str(formData.get('email')),
    phone: str(formData.get('phone')),
    jobTitle: str(formData.get('jobTitle')),
    companyId: str(formData.get('companyId')),
    companyName: str(formData.get('companyName')),
    lifecycleStage: str(formData.get('lifecycleStage')),
    ownerName: str(formData.get('ownerName')),
    notes: str(formData.get('notes')),
  };

  try {
    const id = await saveContact(input, user.email);
    refresh();
    return { ok: true, id };
  } catch (e) {
    if (e instanceof z.ZodError) return fromZod(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save the contact' };
  }
}

const archiveSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(['company', 'contact']),
  restore: z.boolean().default(false),
});

export async function archiveCrmRecordAction(formData: FormData): Promise<CrmActionResult> {
  const user = await requireUser();
  const parsed = archiveSchema.safeParse({
    id: str(formData.get('id')),
    kind: str(formData.get('kind')),
    restore: str(formData.get('restore')) === '1',
  });
  if (!parsed.success) return fromZod(parsed.error);

  try {
    if (parsed.data.kind === 'company') {
      await archiveCompany(parsed.data.id, user.email, parsed.data.restore);
    } else {
      await archiveContact(parsed.data.id, user.email, parsed.data.restore);
    }
    refresh();
    return { ok: true, id: parsed.data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not archive the record' };
  }
}
