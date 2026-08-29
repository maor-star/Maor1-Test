import { sql } from 'drizzle-orm';
import { crmCompanies, crmContacts, db } from '@/lib/db';
import { recordFailure, recordSuccess } from '@/lib/integrations/health';
import type {
  HubSpotAdapter, HubSpotCompany, HubSpotContact, HubSpotOwner,
} from '@/lib/integrations/hubspot';

/**
 * Copies HubSpot into the cockpit's own tables.
 *
 * Written to run to completion over tens of thousands of records: it pages,
 * upserts in batches, and can be resumed from a cursor. Owner ids are resolved
 * to names once per run rather than per record — the CRM has a handful of
 * owners and 60,000+ companies.
 */

const BATCH = 200;

export interface MirrorResult {
  companies: number;
  contacts: number;
  pages: number;
  error?: string;
}

function ownerLookup(owners: HubSpotOwner[]): Map<string, string> {
  return new Map(owners.map((o) => [o.id, o.name]));
}

async function upsertCompanies(rows: HubSpotCompany[], owners: Map<string, string>) {
  if (rows.length === 0) return 0;
  const values = rows.map((c) => ({
    hubspotId: c.hubspotId,
    name: c.name,
    domain: c.domain,
    lifecycleStage: c.lifecycleStage,
    ownerId: c.ownerId,
    ownerName: c.ownerId ? (owners.get(c.ownerId) ?? null) : null,
    industry: c.industry,
    country: c.country,
    city: c.city,
    phone: c.phone,
    contactCount: c.contactCount,
    hsCreatedAt: c.hsCreatedAt,
    hsUpdatedAt: c.hsUpdatedAt,
    syncedAt: new Date(),
  }));

  await db
    .insert(crmCompanies)
    .values(values)
    .onConflictDoUpdate({
      target: crmCompanies.hubspotId,
      set: {
        name: sql`excluded.name`,
        domain: sql`excluded.domain`,
        lifecycleStage: sql`excluded.lifecycle_stage`,
        ownerId: sql`excluded.owner_id`,
        ownerName: sql`excluded.owner_name`,
        industry: sql`excluded.industry`,
        country: sql`excluded.country`,
        city: sql`excluded.city`,
        phone: sql`excluded.phone`,
        contactCount: sql`excluded.contact_count`,
        hsCreatedAt: sql`excluded.hs_created_at`,
        hsUpdatedAt: sql`excluded.hs_updated_at`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  return values.length;
}

async function upsertContacts(rows: HubSpotContact[], owners: Map<string, string>) {
  if (rows.length === 0) return 0;
  const values = rows.map((c) => ({
    hubspotId: c.hubspotId,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    jobTitle: c.jobTitle,
    companyName: c.companyName,
    companyId: c.companyId,
    lifecycleStage: c.lifecycleStage,
    ownerId: c.ownerId,
    ownerName: c.ownerId ? (owners.get(c.ownerId) ?? null) : null,
    lastActivityAt: c.lastActivityAt,
    hsCreatedAt: c.hsCreatedAt,
    hsUpdatedAt: c.hsUpdatedAt,
    syncedAt: new Date(),
  }));

  await db
    .insert(crmContacts)
    .values(values)
    .onConflictDoUpdate({
      target: crmContacts.hubspotId,
      set: {
        firstName: sql`excluded.first_name`,
        lastName: sql`excluded.last_name`,
        email: sql`excluded.email`,
        phone: sql`excluded.phone`,
        jobTitle: sql`excluded.job_title`,
        companyName: sql`excluded.company_name`,
        companyId: sql`excluded.company_id`,
        lifecycleStage: sql`excluded.lifecycle_stage`,
        ownerId: sql`excluded.owner_id`,
        ownerName: sql`excluded.owner_name`,
        lastActivityAt: sql`excluded.last_activity_at`,
        hsCreatedAt: sql`excluded.hs_created_at`,
        hsUpdatedAt: sql`excluded.hs_updated_at`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  return values.length;
}

/**
 * Full copy. `maxPages` bounds a single run so a scheduled job cannot sit on
 * the API for an hour; a run that stops early reports its cursor so the next
 * one picks up where it left off.
 */
export async function mirrorHubSpot(
  adapter: HubSpotAdapter,
  opts: { maxPages?: number; onProgress?: (n: { companies: number; contacts: number }) => void } = {},
): Promise<MirrorResult> {
  const maxPages = opts.maxPages ?? 1_000;
  let companies = 0;
  let contacts = 0;
  let pages = 0;

  try {
    const owners = ownerLookup(await adapter.listOwners());

    let after: string | null = null;
    do {
      const page: Awaited<ReturnType<HubSpotAdapter['listCompanies']>> =
        await adapter.listCompanies(after, BATCH);
      companies += await upsertCompanies(page.rows, owners);
      after = page.after;
      pages += 1;
      opts.onProgress?.({ companies, contacts });
    } while (after && pages < maxPages);

    after = null;
    do {
      const page: Awaited<ReturnType<HubSpotAdapter['listContacts']>> =
        await adapter.listContacts(after, BATCH);
      contacts += await upsertContacts(page.rows, owners);
      after = page.after;
      pages += 1;
      opts.onProgress?.({ companies, contacts });
    } while (after && pages < maxPages);

    await recordSuccess('hubspot');
    return { companies, contacts, pages };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown';
    await recordFailure('hubspot', message);
    // Whatever was written before the failure stays written: a partial copy the
    // CEO can see beats an empty screen and a log line.
    return { companies, contacts, pages, error: message };
  }
}

/** Row counts, for the sync status line. */
export async function crmCounts() {
  const [companies] = await db
    .select({ n: sql<number>`count(*)::int`, at: sql<Date | null>`max(synced_at)` })
    .from(crmCompanies);
  const [contacts] = await db
    .select({ n: sql<number>`count(*)::int`, at: sql<Date | null>`max(synced_at)` })
    .from(crmContacts);

  return {
    companies: companies?.n ?? 0,
    contacts: contacts?.n ?? 0,
    lastSyncedAt: companies?.at ?? contacts?.at ?? null,
  };
}
