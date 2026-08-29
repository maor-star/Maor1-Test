import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
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
  page?: number;
}

export async function listCompanies(filter: CrmFilter = {}) {
  const page = Math.max(0, filter.page ?? 0);
  const where = [];

  if (filter.q?.trim()) {
    const q = `%${filter.q.trim()}%`;
    where.push(or(ilike(crmCompanies.name, q), ilike(crmCompanies.domain, q))!);
  }
  if (filter.stage) where.push(eq(crmCompanies.lifecycleStage, filter.stage));

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
    .where(and(isNotNull(crmContacts.companyId), inArray(crmContacts.companyId, companyIds)))
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
  lastSyncedAt: Date | null;
  byStage: { stage: string; label: string; companies: number }[];
  owners: { owner: string; companies: number }[];
}

export async function crmSummary(): Promise<CrmSummary> {
  const [[companies], [contacts], stages, owners] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int`, at: sql<Date | null>`max(synced_at)` })
      .from(crmCompanies),
    db
      .select({
        n: sql<number>`count(*)::int`,
        withEmail: sql<number>`count(*) filter (where email is not null)::int`,
      })
      .from(crmContacts),
    db
      .select({ stage: crmCompanies.lifecycleStage, n: sql<number>`count(*)::int` })
      .from(crmCompanies)
      .groupBy(crmCompanies.lifecycleStage),
    db
      .select({ owner: crmCompanies.ownerName, n: sql<number>`count(*)::int` })
      .from(crmCompanies)
      .where(isNotNull(crmCompanies.ownerName))
      .groupBy(crmCompanies.ownerName)
      .orderBy(desc(sql`count(*)`))
      .limit(8),
  ]);

  const order = [...STAGE_ORDER] as string[];

  return {
    companies: companies?.n ?? 0,
    contacts: contacts?.n ?? 0,
    contactsWithEmail: contacts?.withEmail ?? 0,
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
