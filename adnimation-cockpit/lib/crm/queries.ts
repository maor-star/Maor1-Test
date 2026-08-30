import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { crmCompanies, crmContacts, db } from '@/lib/db';

/**
 * The CRM as the cockpit holds it.
 *
 * The portal runs to tens of thousands of companies, so everything here is
 * paged and filtered in the database. Loading the book into memory to sort it
 * in JavaScript would work today at a thousand rows and fall over at sixty.
 */

export const PAGE_SIZE = 50;

/** Lifecycle stages, ordered by how far along the sale is. */
export const STAGE_ORDER = [
  'customer',
  'opportunity',
  'salesqualifiedlead',
  'marketingqualifiedlead',
  'lead',
  'subscriber',
  'evangelist',
  'other',
] as const;

export const STAGE_LABEL: Record<string, string> = {
  customer: 'CUSTOMER',
  opportunity: 'OPPORTUNITY',
  salesqualifiedlead: 'SALES QUALIFIED',
  marketingqualifiedlead: 'MARKETING QUALIFIED',
  lead: 'LEAD',
  subscriber: 'SUBSCRIBER',
  evangelist: 'EVANGELIST',
  other: 'UNSTAGED',
};

export const stageLabel = (stage: string | null): string =>
  stage ? (STAGE_LABEL[stage] ?? stage.replace(/_/g, ' ').toUpperCase()) : 'UNSTAGED';

export interface CrmFilter {
  q?: string;
  stage?: string;
  owner?: string;
  country?: string;
  industry?: string;
  /** Only companies we actually have a person at. */
  withContacts?: boolean;
  /** 'local' for records created here, 'hubspot' for copied ones. */
  source?: string;
  /** Retired records are hidden unless this is set — nothing is ever deleted. */
  archived?: boolean;
  page?: number;
}

/**
 * The filters shared by both views. Kept in one place so the companies list and
 * the contacts list can never disagree about what a filter means.
 */
function companyWhere(filter: CrmFilter) {
  const where = [];

  if (filter.q?.trim()) {
    const q = `%${filter.q.trim()}%`;
    where.push(or(ilike(crmCompanies.name, q), ilike(crmCompanies.domain, q))!);
  }
  if (filter.stage) where.push(eq(crmCompanies.lifecycleStage, filter.stage));
  if (filter.owner) where.push(eq(crmCompanies.ownerName, filter.owner));
  if (filter.country) where.push(eq(crmCompanies.country, filter.country));
  if (filter.industry) where.push(eq(crmCompanies.industry, filter.industry));
  if (filter.withContacts) where.push(sql`${crmCompanies.contactCount} > 0`);
  if (filter.source) where.push(eq(crmCompanies.source, filter.source));
  where.push(filter.archived ? isNotNull(crmCompanies.archivedAt) : isNull(crmCompanies.archivedAt));

  return where;
}

export async function listCompanies(filter: CrmFilter = {}) {
  const page = Math.max(0, filter.page ?? 0);
  const where = companyWhere(filter);

  const clause = where.length > 0 ? and(...where) : undefined;

  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(crmCompanies)
      .where(clause)
      .orderBy(desc(crmCompanies.contactCount), asc(crmCompanies.name))
      .limit(PAGE_SIZE)
      .offset(page * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(crmCompanies).where(clause),
  ]);

  return { rows, total: count?.n ?? 0, page, pageSize: PAGE_SIZE };
}

export async function listContacts(filter: CrmFilter = {}) {
  const page = Math.max(0, filter.page ?? 0);
  const where = [];

  if (filter.q?.trim()) {
    const q = `%${filter.q.trim()}%`;
    where.push(
      or(
        ilike(crmContacts.firstName, q),
        ilike(crmContacts.lastName, q),
        ilike(crmContacts.email, q),
        ilike(crmContacts.companyName, q),
      )!,
    );
  }
  if (filter.stage) where.push(eq(crmContacts.lifecycleStage, filter.stage));
  if (filter.owner) where.push(eq(crmContacts.ownerName, filter.owner));
  if (filter.source) where.push(eq(crmContacts.source, filter.source));
  where.push(filter.archived ? isNotNull(crmContacts.archivedAt) : isNull(crmContacts.archivedAt));

  const clause = where.length > 0 ? and(...where) : undefined;

  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(crmContacts)
      .where(clause)
      .orderBy(desc(crmContacts.hsUpdatedAt))
      .limit(PAGE_SIZE)
      .offset(page * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(crmContacts).where(clause),
  ]);

  return { rows, total: count?.n ?? 0, page, pageSize: PAGE_SIZE };
}

/** Contacts attached to a set of companies, for the expanded rows. */
export async function contactsForCompanies(companyIds: string[]) {
  if (companyIds.length === 0) return new Map<string, (typeof crmContacts.$inferSelect)[]>();

  const rows = await db
    .select()
    .from(crmContacts)
    .where(
      and(
        isNotNull(crmContacts.companyId),
        inArray(crmContacts.companyId, companyIds),
        isNull(crmContacts.archivedAt),
      ),
    )
    .orderBy(asc(crmContacts.lastName));

  const byCompany = new Map<string, (typeof crmContacts.$inferSelect)[]>();
  for (const row of rows) {
    if (!row.companyId) continue;
    byCompany.set(row.companyId, [...(byCompany.get(row.companyId) ?? []), row]);
  }
  return byCompany;
}

export interface CrmSummary {
  companies: number;
  contacts: number;
  contactsWithEmail: number;
  /** Created or edited here rather than copied — what survives HubSpot going. */
  ownedHere: number;
  archived: number;
  lastSyncedAt: Date | null;
  byStage: { stage: string; label: string; companies: number }[];
  owners: { owner: string; companies: number }[];
}

export async function crmSummary(): Promise<CrmSummary> {
  const [[companies], [contacts], stages, owners] = await Promise.all([
    db
      .select({
        n: sql<number>`count(*) filter (where archived_at is null)::int`,
        at: sql<Date | null>`max(synced_at)`,
        owned: sql<number>`count(*) filter (where (source = 'local' or edited_at is not null) and archived_at is null)::int`,
        archived: sql<number>`count(*) filter (where archived_at is not null)::int`,
      })
      .from(crmCompanies),
    db
      .select({
        n: sql<number>`count(*) filter (where archived_at is null)::int`,
        withEmail: sql<number>`count(*) filter (where email is not null and archived_at is null)::int`,
      })
      .from(crmContacts),
    db
      .select({ stage: crmCompanies.lifecycleStage, n: sql<number>`count(*)::int` })
      .from(crmCompanies)
      .where(isNull(crmCompanies.archivedAt))
      .groupBy(crmCompanies.lifecycleStage),
    db
      .select({ owner: crmCompanies.ownerName, n: sql<number>`count(*)::int` })
      .from(crmCompanies)
      .where(and(isNotNull(crmCompanies.ownerName), isNull(crmCompanies.archivedAt)))
      .groupBy(crmCompanies.ownerName)
      .orderBy(desc(sql`count(*)`))
      .limit(8),
  ]);

  const order = [...STAGE_ORDER] as string[];

  return {
    companies: companies?.n ?? 0,
    contacts: contacts?.n ?? 0,
    contactsWithEmail: contacts?.withEmail ?? 0,
    ownedHere: companies?.owned ?? 0,
    archived: companies?.archived ?? 0,
    lastSyncedAt: companies?.at ?? null,
    byStage: stages
      .map((s) => ({
        stage: s.stage ?? 'other',
        label: stageLabel(s.stage),
        companies: s.n,
      }))
      .sort((a, b) => {
        const ai = order.indexOf(a.stage);
        const bi = order.indexOf(b.stage);
        return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
      }),
    owners: owners.map((o) => ({ owner: o.owner ?? 'Unassigned', companies: o.n })),
  };
}

export interface CrmFilterOptions {
  owners: { value: string; n: number }[];
  countries: { value: string; n: number }[];
  industries: { value: string; n: number }[];
}

/**
 * What there is to filter by, counted from the book itself. Offering a fixed
 * list would show stages and industries the portal does not actually use, and
 * hide the ones it does.
 */
export async function crmFilterOptions(): Promise<CrmFilterOptions> {
  const facet = async (column: AnyPgColumn) =>
    db
      .select({ value: column, n: sql<number>`count(*)::int` })
      .from(crmCompanies)
      .where(and(isNotNull(column), isNull(crmCompanies.archivedAt)))
      .groupBy(column)
      .orderBy(desc(sql`count(*)`))
      .limit(30);

  const [owners, countries, industries] = await Promise.all([
    facet(crmCompanies.ownerName),
    facet(crmCompanies.country),
    facet(crmCompanies.industry),
  ]);

  const clean = (rows: { value: string | null; n: number }[]) =>
    rows.filter((r): r is { value: string; n: number } => Boolean(r.value?.trim()));

  return { owners: clean(owners), countries: clean(countries), industries: clean(industries) };
}
