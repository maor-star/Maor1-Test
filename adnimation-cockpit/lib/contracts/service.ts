import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contracts, db, departments, partners, people } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { filingFolder, type ContractCategory } from './drive';
import { buildBoard, type ContractBoard, type ContractView } from './board';
import {
  CONTRACT_STATUSES, OPEN_STATUSES, escalationFor, renewalState,
  type ContractRecord, type ContractStatus,
} from './status';

/**
 * Database access for the contracts module. The arranging — lanes, renewals,
 * the Drive tree — lives in `board.ts`, which stays free of the db import so it
 * can be tested without one.
 */

const driveUrl = (folderId: string | null) =>
  folderId ? `https://drive.google.com/drive/folders/${folderId}` : null;

const isoDay = (d: Date | string | null): string | null => {
  if (d === null) return null;
  return typeof d === 'string' ? d : d.toISOString().slice(0, 10);
};

const selection = {
  id: contracts.id,
  counterparty: contracts.counterpartyName,
  category: contracts.category,
  categoryConfirmed: contracts.categoryConfirmed,
  docType: contracts.docType,
  status: contracts.status,
  statusChangedAt: contracts.statusChangedAt,
  startDate: contracts.startDate,
  endDate: contracts.endDate,
  renewal: contracts.renewal,
  noticePeriodDays: contracts.noticePeriodDays,
  valueCents: contracts.valueCents,
  legalOwner: contracts.legalOwner,
  driveFolderId: contracts.driveFolderId,
  deptCode: departments.code,
  deptName: departments.nameHe,
  partnerName: partners.name,
  ownerName: people.name,
};

const baseQuery = () =>
  db
    .select(selection)
    .from(contracts)
    .leftJoin(departments, eq(contracts.deptId, departments.id))
    .leftJoin(partners, eq(contracts.partnerId, partners.id))
    .leftJoin(people, eq(contracts.bizOwnerPersonId, people.id));

/** The shape one row of `baseQuery` comes back as. */
type Selected = Awaited<ReturnType<typeof baseQuery>>[number];

function toView(row: Selected, now: Date): ContractView {
  const status = row.status as ContractStatus;
  const statusChangedAt = row.statusChangedAt.toISOString();
  const endDate = isoDay(row.endDate);
  // The stage decides which sub-folder the documents live in: an unexecuted
  // draft must not land beside the signed originals.
  const stage = status === 'signed' || status === 'expired' ? 'signed' : 'in_review';

  return {
    id: row.id,
    counterparty: row.counterparty,
    category: row.category as ContractCategory,
    docType: row.docType,
    docTypeLabel: row.docType.toUpperCase(),
    status,
    statusChangedAt,
    endDate,
    noticePeriodDays: row.noticePeriodDays,
    valueCents: row.valueCents,
    owner: row.ownerName ?? row.legalOwner,
    deptCode: row.deptCode,
    driveFolderPath: filingFolder(row.counterparty, row.category as ContractCategory, stage).path,
    // A category nobody has confirmed is a guess, and a guess files documents
    // into the wrong client folder — so it is surfaced, not trusted.
    needsReview: !row.categoryConfirmed,
    sourceUrl: driveUrl(row.driveFolderId),
    partnerName: row.partnerName,
    deptName: row.deptName,
    filing: filingFolder(row.counterparty, row.category as ContractCategory, stage),
    escalation: escalationFor(status, statusChangedAt, now),
    renewal: renewalState(endDate, row.noticePeriodDays, now),
    daysInStatus: Math.max(0, Math.floor((now.getTime() - row.statusChangedAt.getTime()) / 86_400_000)),
  };
}

export async function listContracts(
  opts: { statuses?: ContractStatus[]; now?: Date } = {},
): Promise<ContractView[]> {
  const now = opts.now ?? new Date();
  const rows = opts.statuses?.length
    ? await baseQuery().where(inArray(contracts.status, opts.statuses)).orderBy(asc(contracts.statusChangedAt))
    : await baseQuery().orderBy(asc(contracts.statusChangedAt));
  return rows.map((r) => toView(r as Selected, now));
}

/** Everything the contracts screen needs, in one pass. */
export async function contractBoard(now = new Date()): Promise<ContractBoard> {
  return buildBoard(await listContracts({ now }));
}

/** The cadence engine takes plain records, not view models. */
export async function contractRecords(now = new Date()): Promise<ContractRecord[]> {
  return listContracts({ now });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const emptyToNull = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), inner);

export const contractInputSchema = z.object({
  counterparty: z.string().trim().min(1, 'Counterparty is required').max(200),
  category: z.enum(['demand', 'supply', 'general']),
  categoryConfirmed: z.boolean().default(true),
  docType: z.string().trim().min(1, 'Document type is required').max(60),
  status: z.enum(CONTRACT_STATUSES).default('draft'),
  deptId: emptyToNull(z.string().uuid().nullable()).optional(),
  startDate: emptyToNull(isoDate.nullable()).optional(),
  endDate: emptyToNull(isoDate.nullable()).optional(),
  renewal: emptyToNull(z.enum(['auto', 'manual']).nullable()).optional(),
  noticePeriodDays: emptyToNull(z.coerce.number().int().min(0).max(365).nullable()).optional(),
  valueCents: emptyToNull(z.coerce.number().int().min(0).nullable()).optional(),
  legalOwner: emptyToNull(z.string().trim().max(120).nullable()).optional(),
});

export type ContractInput = z.input<typeof contractInputSchema>;

export async function createContract(input: ContractInput, actor: string): Promise<string> {
  const parsed = contractInputSchema.parse(input);

  const [row] = await db
    .insert(contracts)
    .values({
      counterpartyName: parsed.counterparty,
      category: parsed.category,
      categoryConfirmed: parsed.categoryConfirmed,
      docType: parsed.docType,
      status: parsed.status,
      statusChangedAt: new Date(),
      deptId: parsed.deptId ?? null,
      startDate: parsed.startDate ?? null,
      endDate: parsed.endDate ?? null,
      renewal: parsed.renewal ?? null,
      noticePeriodDays: parsed.noticePeriodDays ?? null,
      valueCents: parsed.valueCents ?? null,
      legalOwner: parsed.legalOwner ?? null,
    })
    .returning({ id: contracts.id });

  if (!row) throw new Error('Contract insert returned nothing');

  await writeAudit({
    actor,
    action: 'contract.create',
    entityType: 'contract',
    entityId: row.id,
    after: { ...parsed, filing: filingFolder(parsed.counterparty, parsed.category).path },
  });

  return row.id;
}

/**
 * Moving a contract along the lifecycle. `status_changed_at` is reset on every
 * move, because the chase ladder counts from the last move, not from creation.
 */
export async function setContractStatus(
  id: string,
  status: ContractStatus,
  actor: string,
): Promise<void> {
  const [before] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  if (!before) throw new Error('No contract with that id');

  await db
    .update(contracts)
    .set({ status, statusChangedAt: new Date() })
    .where(eq(contracts.id, id));

  await writeAudit({
    actor,
    action: 'contract.status',
    entityType: 'contract',
    entityId: id,
    before: { status: before.status },
    after: { status },
  });
}

/** Confirming the filing category is what clears the review flag. */
export async function confirmCategory(
  id: string,
  category: ContractCategory,
  actor: string,
): Promise<void> {
  const [before] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  if (!before) throw new Error('No contract with that id');

  await db
    .update(contracts)
    .set({ category, categoryConfirmed: true })
    .where(eq(contracts.id, id));

  await writeAudit({
    actor,
    action: 'contract.confirm_category',
    entityType: 'contract',
    entityId: id,
    before: { category: before.category, confirmed: before.categoryConfirmed },
    after: { category, confirmed: true },
  });
}

/** Counts for the cockpit strip, without loading every row. */
export async function openContractCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contracts)
    .where(and(inArray(contracts.status, [...OPEN_STATUSES]), isNotNull(contracts.counterpartyName)));
  return row?.n ?? 0;
}

export async function listDepartments() {
  return db.select().from(departments).orderBy(desc(departments.active), asc(departments.code));
}
