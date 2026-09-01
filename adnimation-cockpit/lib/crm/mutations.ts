import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { crmCompanies, crmContacts, db } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { restorableSnapshot } from '@/lib/undo';
import {
  LOCAL_ID_PREFIX, companyInputSchema, contactInputSchema,
  type CompanyInput, type ContactInput,
} from './schemas';

export * from './schemas';

/**
 * Writing to the CRM.
 *
 * The CRM began as a read-only copy of HubSpot. It is now the book itself:
 * HubSpot is being wound down, so records have to be creatable, editable and
 * retirable here, and none of that may be undone by the next sync.
 *
 * Two rules hold that together:
 *
 *  - Editing a record stamps `editedAt`. The sync skips any row that carries
 *    one, permanently. The edit made here wins over whatever HubSpot still
 *    says, because here is where the work is being done now.
 *  - Nothing is deleted. Archiving sets `archivedAt`; every list hides those
 *    rows and the record survives (CLAUDE.md §2 — archive only, everywhere).
 *
 * A record created here gets a `local:` id rather than a HubSpot one, so the
 * two can never collide and the sync's upsert can never touch it.
 */

/**
 * A company's contact count is maintained by HubSpot for copied records. Once
 * contacts are being created here it has to be recomputed, or the number drifts
 * away from the list sitting underneath it.
 */
async function recountCompany(companyId: string | null) {
  if (!companyId) return;
  await db
    .update(crmCompanies)
    .set({
      contactCount: sql`(
        select count(*)::int from crm_contacts c
        where c.company_id = ${companyId} and c.archived_at is null
      )`,
    })
    .where(eq(crmCompanies.hubspotId, companyId));
}

export async function saveCompany(input: CompanyInput, actor: string): Promise<string> {
  const parsed = companyInputSchema.parse(input);
  const now = new Date();

  const values = {
    name: parsed.name,
    domain: parsed.domain ?? null,
    lifecycleStage: parsed.lifecycleStage ?? null,
    ownerName: parsed.ownerName ?? null,
    industry: parsed.industry ?? null,
    country: parsed.country ?? null,
    city: parsed.city ?? null,
    phone: parsed.phone ?? null,
    notes: parsed.notes ?? null,
    editedAt: now,
    editedBy: actor,
  };

  if (parsed.id) {
    const [before] = await db
      .select()
      .from(crmCompanies)
      .where(eq(crmCompanies.hubspotId, parsed.id))
      .limit(1);
    if (!before) throw new Error('No company with that id');

    await db.update(crmCompanies).set(values).where(eq(crmCompanies.hubspotId, parsed.id));
    await writeAudit({
      actor,
      action: 'crm.company.update',
      entityType: 'crm_company',
      entityId: parsed.id,
      before: { name: before.name, lifecycleStage: before.lifecycleStage, ownerName: before.ownerName },
      after: { name: values.name, lifecycleStage: values.lifecycleStage, ownerName: values.ownerName },
    });
    return parsed.id;
  }

  const id = `${LOCAL_ID_PREFIX}${randomUUID()}`;
  await db.insert(crmCompanies).values({
    ...values,
    hubspotId: id,
    source: 'local',
    contactCount: 0,
    syncedAt: now,
  });

  await writeAudit({
    actor,
    action: 'crm.company.create',
    entityType: 'crm_company',
    entityId: id,
    after: values,
  });
  return id;
}

export async function saveContact(input: ContactInput, actor: string): Promise<string> {
  const parsed = contactInputSchema.parse(input);
  const now = new Date();

  // The company is chosen by typing its name — a dropdown cannot serve sixty
  // thousand of them. So the name is resolved to an id here: an exact match
  // links the contact, and a name that matches nothing is kept as plain text
  // rather than rejected, because a contact at a company we have not recorded
  // yet is still a contact worth having.
  let companyName = parsed.companyName ?? null;
  let companyId = parsed.companyId ?? null;

  if (companyId) {
    const [company] = await db
      .select({ name: crmCompanies.name })
      .from(crmCompanies)
      .where(eq(crmCompanies.hubspotId, companyId))
      .limit(1);
    if (company && (!companyName || company.name === companyName)) companyName = company.name;
    else companyId = null;
  }

  if (!companyId && companyName) {
    const [match] = await db
      .select({ id: crmCompanies.hubspotId, name: crmCompanies.name })
      .from(crmCompanies)
      .where(and(sql`lower(${crmCompanies.name}) = lower(${companyName})`, isNull(crmCompanies.archivedAt)))
      .limit(1);
    if (match) {
      companyId = match.id;
      companyName = match.name;
    }
  }

  const values = {
    firstName: parsed.firstName ?? null,
    lastName: parsed.lastName ?? null,
    email: parsed.email ?? null,
    phone: parsed.phone ?? null,
    jobTitle: parsed.jobTitle ?? null,
    companyId,
    companyName,
    lifecycleStage: parsed.lifecycleStage ?? null,
    ownerName: parsed.ownerName ?? null,
    notes: parsed.notes ?? null,
    editedAt: now,
    editedBy: actor,
  };

  if (parsed.id) {
    const [before] = await db
      .select()
      .from(crmContacts)
      .where(eq(crmContacts.hubspotId, parsed.id))
      .limit(1);
    if (!before) throw new Error('No contact with that id');

    await db.update(crmContacts).set(values).where(eq(crmContacts.hubspotId, parsed.id));
    await writeAudit({
      actor,
      action: 'crm.contact.update',
      entityType: 'crm_contact',
      entityId: parsed.id,
      before: restorableSnapshot('crm_contact', before),
      after: { email: values.email, companyId: values.companyId },
    });

    // A contact can move between companies, so both counts have to be redone.
    await recountCompany(before.companyId);
    await recountCompany(values.companyId);
    return parsed.id;
  }

  const id = `${LOCAL_ID_PREFIX}${randomUUID()}`;
  await db.insert(crmContacts).values({ ...values, hubspotId: id, source: 'local', syncedAt: now });

  await writeAudit({
    actor,
    action: 'crm.contact.create',
    entityType: 'crm_contact',
    entityId: id,
    after: values,
  });

  await recountCompany(values.companyId);
  return id;
}

/** Retire a record. It stays in the table; every list stops showing it. */
export async function archiveCompany(id: string, actor: string, restore = false) {
  await db
    .update(crmCompanies)
    .set({ archivedAt: restore ? null : new Date(), editedAt: new Date(), editedBy: actor })
    .where(eq(crmCompanies.hubspotId, id));

  await writeAudit({
    actor,
    action: restore ? 'crm.company.restore' : 'crm.company.archive',
    entityType: 'crm_company',
    entityId: id,
  });
}

export async function archiveContact(id: string, actor: string, restore = false) {
  const [before] = await db
    .select({ companyId: crmContacts.companyId, archivedAt: crmContacts.archivedAt })
    .from(crmContacts)
    .where(eq(crmContacts.hubspotId, id))
    .limit(1);

  await db
    .update(crmContacts)
    .set({ archivedAt: restore ? null : new Date(), editedAt: new Date(), editedBy: actor })
    .where(eq(crmContacts.hubspotId, id));

  await writeAudit({
    actor,
    action: restore ? 'crm.contact.restore' : 'crm.contact.archive',
    entityType: 'crm_contact',
    entityId: id,
    before: { archivedAt: before?.archivedAt ?? null },
    after: { archivedAt: restore ? null : new Date() },
  });

  await recountCompany(before?.companyId ?? null);
}

/**
 * Company names to suggest when attaching a contact to one.
 *
 * The book holds sixty thousand companies, so this is a suggestion list for a
 * typed field, not the full set: the ones with people already attached, which
 * are the ones a new contact is overwhelmingly likely to belong to. A name that
 * is not in the list is still accepted — saveContact resolves it, or keeps it
 * as text.
 */
export async function companySuggestions(limit = 800): Promise<string[]> {
  const rows = await db
    .select({ name: crmCompanies.name })
    .from(crmCompanies)
    .where(isNull(crmCompanies.archivedAt))
    .orderBy(desc(crmCompanies.contactCount), crmCompanies.name)
    .limit(limit);
  return rows.map((r) => r.name);
}
