import { z } from 'zod';

/**
 * What an opportunity is, and when it has gone cold — with no database
 * underneath, so the judgements can be tested directly.
 *
 * The premise of this module is different from the pipeline's. The pipeline
 * tracks deals that are already moving and have an owner, a stage and a next
 * step. This tracks the thing that has no owner yet: something he noticed,
 * meant to do, and has not done. Those do not fail loudly — they simply stop
 * being mentioned. So the one number that matters here is how long an
 * opportunity has sat without a decision, and the default sort is oldest and
 * most valuable first, not newest.
 */

export const OPPORTUNITY_KINDS = [
  'supply', 'demand', 'mutual', 'partnership', 'product', 'upsell', 'cost', 'hiring',
  'investment', 'other',
] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

export const KIND_LABEL: Record<OpportunityKind, string> = {
  supply: 'NEW SUPPLY',
  demand: 'NEW DEMAND',
  // The same partner on both sides: they send us supply and buy demand. It is
  // the arrangement he most wants, and it was the one kind he could not file.
  mutual: 'MUTUAL — DEMAND AND SUPPLY',
  partnership: 'PARTNERSHIP',
  product: 'PRODUCT',
  upsell: 'UPSELL / EXISTING',
  cost: 'COST / EFFICIENCY',
  hiring: 'HIRING',
  investment: 'INVESTMENT / M&A',
  other: 'OTHER',
};

/**
 * `suggested` is what the mail detector files; it is not his list until he
 * says so. Everything else he set himself.
 */
export const OPPORTUNITY_STATUSES = [
  'suggested', 'new', 'exploring', 'parked', 'won', 'lost',
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const STATUS_LABEL: Record<OpportunityStatus, string> = {
  suggested: 'SUGGESTED',
  new: 'NOT STARTED',
  exploring: 'EXPLORING',
  parked: 'PARKED',
  won: 'TAKEN',
  lost: 'MISSED',
};

/** The statuses that are still live decisions — the ones that can go cold. */
export const LIVE_STATUSES: OpportunityStatus[] = ['new', 'exploring', 'parked'];

export const OPPORTUNITY_VIEWS = ['open', 'cold', 'inbox', 'parked', 'closed', 'all'] as const;
export type OpportunityView = (typeof OPPORTUNITY_VIEWS)[number];

export const VIEW_LABEL: Record<OpportunityView, string> = {
  open: 'OPEN',
  cold: 'GONE COLD',
  inbox: 'SUGGESTED',
  parked: 'PARKED',
  closed: 'DECIDED',
  all: 'EVERYTHING',
};

/**
 * How an opportunity's kind maps onto the pipeline's client types, for when it
 * matures into a deal. The pipeline splits the business by side; several kinds
 * of opportunity are not a side of the business at all, and land on `other`
 * rather than being forced into one.
 */
export const KIND_TO_CLIENT_TYPE: Record<OpportunityKind, string> = {
  supply: 'supply',
  demand: 'demand',
  mutual: 'mutual',
  partnership: 'other',
  product: 'other',
  upsell: 'other',
  cost: 'vendor',
  hiring: 'other',
  investment: 'other',
  other: 'other',
};

export const OPPORTUNITY_SOURCES = ['manual', 'mail', 'slack'] as const;
export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number];

/** An open opportunity nobody has touched for this long has gone cold. */
export const COLD_AFTER_DAYS = 14;

export interface OpportunityRow {
  id: string;
  title: string;
  kind: OpportunityKind;
  status: OpportunityStatus;
  note: string | null;
  /** Rough size, in cents. Null when he has not put a number on it. */
  valueCents: number | null;
  counterparty: string | null;
  nextStep: string | null;
  nextStepDate: string | null;
  /** When a parked opportunity should come back to him. */
  revisitOn: string | null;
  source: OpportunitySource;
  sourceUrl: string | null;
  sourceExcerpt: string | null;
  sourceAt: Date | null;
  createdAt: Date;
  lastTouchedAt: Date;
  decidedAt: Date | null;
  decidedNote: string | null;
  /** Set once it has matured into a pipeline deal. */
  pipelineClientId: string | null;
  promotedAt: Date | null;
}

export interface OpportunityState {
  /** Days since anything happened to it. */
  daysQuiet: number;
  /** Open, but he never said what he would do about it. */
  needsNextStep: boolean;
  /** Parked, and the date he chose to look again has passed. */
  dueToRevisit: boolean;
  /** Open, no next step, and quiet long enough that it is slipping away. */
  cold: boolean;
  /** A next step whose date has passed. */
  overdue: boolean;
}

const daysBetween = (from: Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));

export function classify(row: OpportunityRow, now = new Date()): OpportunityState {
  const today = now.toISOString().slice(0, 10);
  const daysQuiet = daysBetween(row.lastTouchedAt, now);
  const live = LIVE_STATUSES.includes(row.status);

  const needsNextStep = live && row.status !== 'parked' && !row.nextStep;
  const dueToRevisit = row.status === 'parked' && row.revisitOn !== null && row.revisitOn <= today;
  const overdue = live && row.nextStepDate !== null && row.nextStepDate < today;

  // Parked is a decision, so it cannot go cold — it comes back on its date
  // instead. Cold is for the ones he never decided anything about.
  const cold =
    live && row.status !== 'parked' && daysQuiet >= COLD_AFTER_DAYS && (needsNextStep || overdue);

  return { daysQuiet, needsNextStep, dueToRevisit, cold, overdue };
}

export function inView(row: OpportunityRow, view: OpportunityView, now = new Date()): boolean {
  const state = classify(row, now);
  switch (view) {
    case 'inbox':
      return row.status === 'suggested';
    case 'open':
      return row.status === 'new' || row.status === 'exploring';
    case 'cold':
      return state.cold || state.dueToRevisit;
    case 'parked':
      return row.status === 'parked';
    case 'closed':
      return row.status === 'won' || row.status === 'lost';
    case 'all':
      return true;
  }
}

/**
 * Oldest and biggest first.
 *
 * A list of unrealised opportunities sorted newest-first is a list he reads
 * the top of and never the bottom of, which is how they died in the first
 * place. Cold ones lead, then the ones with real money on them, then age.
 */
export function rank(rows: OpportunityRow[], now = new Date()): OpportunityRow[] {
  return [...rows].sort((a, b) => {
    const sa = classify(a, now);
    const sb = classify(b, now);
    const urgent = (s: OpportunityState) => (s.cold || s.dueToRevisit ? 1 : 0);
    if (urgent(sa) !== urgent(sb)) return urgent(sb) - urgent(sa);
    if ((b.valueCents ?? 0) !== (a.valueCents ?? 0)) return (b.valueCents ?? 0) - (a.valueCents ?? 0);
    return sb.daysQuiet - sa.daysQuiet;
  });
}

const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullable());

/**
 * Money arrives as whatever he typed — "50k", "$1,200", "1.5m" — because a CEO
 * jotting an opportunity should not have to think in cents.
 */
export function parseMoneyToCents(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().toLowerCase().replace(/[$,\s]/g, '');
  if (text === '') return null;

  const match = /^(\d+(?:\.\d+)?)([km])?$/.exec(text);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  const multiplier = match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1;
  return Math.round(amount * multiplier * 100);
}

export const opportunityInputSchema = z.object({
  title: z.string().trim().min(1, 'Say what the opportunity is').max(300),
  kind: z.enum(OPPORTUNITY_KINDS).default('other'),
  status: z.enum(OPPORTUNITY_STATUSES).default('new'),
  note: emptyToNull(z.string().trim().max(8000)).optional(),
  counterparty: emptyToNull(z.string().trim().max(200)).optional(),
  valueCents: z.preprocess(parseMoneyToCents, z.number().int().min(0).nullable()).optional(),
  nextStep: emptyToNull(z.string().trim().max(300)).optional(),
  nextStepDate: emptyToNull(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  ).optional(),
  revisitOn: emptyToNull(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  ).optional(),
  source: z.enum(OPPORTUNITY_SOURCES).default('manual'),
  sourceUrl: emptyToNull(z.string().trim().max(1000)).optional(),
  sourceExcerpt: emptyToNull(z.string().trim().max(4000)).optional(),
});

export type OpportunityInput = z.infer<typeof opportunityInputSchema>;

/**
 * A row as the screen receives it: the record, why the detector proposed it,
 * and the judgement about whether it has gone quiet — all computed on the
 * server so the card stays a renderer.
 *
 * This lives here rather than beside the queries because a client component
 * that imports it must not drag the database driver into the browser bundle.
 */
export interface OpportunityListItem extends OpportunityRow {
  detectReasons: string[];
  state: OpportunityState;
}
