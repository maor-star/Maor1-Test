import type { ContractCategory } from './drive';

/**
 * Contract lifecycle and the chase ladder — spec 9.3 and 9.4.
 *
 * A contract sitting with the other side is the single most common way a deal
 * quietly dies. The ladder turns silence into an escalating, dated obligation
 * rather than something the CEO has to remember.
 */

export const CONTRACT_STATUSES = [
  // Everything arriving from mail or Slack lands here until he says what it is.
  'unclassified',
  'draft',
  'in_review',
  'negotiation',
  'out_for_signature',
  'awaiting_my_signature',
  'signed',
  'expired',
  'cancelled',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const STATUS_LABEL: Record<ContractStatus, string> = {
  unclassified: 'NEEDS CLASSIFYING',
  draft: 'DRAFT',
  in_review: 'IN REVIEW / NEEDS CHANGES',
  negotiation: 'IN NEGOTIATION',
  out_for_signature: 'OUT FOR SIGNATURE',
  awaiting_my_signature: 'AWAITING MY SIGNATURE',
  signed: 'SIGNED',
  expired: 'EXPIRED',
  cancelled: 'CANCELLED',
};

/** Statuses where the contract is still work in progress — the "what's waiting" set. */
export const OPEN_STATUSES: ContractStatus[] = [
  'unclassified',
  'draft',
  'in_review',
  'negotiation',
  'out_for_signature',
  'awaiting_my_signature',
];

/**
 * The statuses he chose to run the board on, in the order work moves through
 * them. `draft` and `negotiation` predate this and are kept so old rows stay
 * valid, but they are not offered as steps.
 */
export const BOARD_STATUSES: ContractStatus[] = [
  'unclassified',
  'in_review',
  'out_for_signature',
  'awaiting_my_signature',
  'signed',
];

/**
 * Whose move it is.
 *
 * The distinction the board is built on: a contract waiting on THEM is a
 * chase, and a contract waiting on HIM is a task. Conflating them is how
 * "awaiting my signature" sits for three weeks looking like someone else's
 * problem.
 */
export const WAITING_ON: Record<ContractStatus, 'you' | 'them' | 'nobody'> = {
  unclassified: 'you',
  draft: 'you',
  in_review: 'you',
  negotiation: 'them',
  out_for_signature: 'them',
  awaiting_my_signature: 'you',
  signed: 'nobody',
  expired: 'nobody',
  cancelled: 'nobody',
};

/** Spec 9.3 — chase at 7, 14 and 21 days of silence. */
export const ESCALATION_DAYS = [7, 14, 21] as const;

export type EscalationLevel = 0 | 1 | 2 | 3;

export interface EscalationStep {
  level: EscalationLevel;
  label: string;
  action: string;
  severity: 'none' | 'watch' | 'warning' | 'critical';
}

const LADDER: Record<EscalationLevel, EscalationStep> = {
  0: { level: 0, label: 'ON TRACK', action: 'No action needed yet.', severity: 'none' },
  1: {
    level: 1,
    label: 'CHASE',
    action: 'Send a polite follow-up to the counterparty.',
    severity: 'watch',
  },
  2: {
    level: 2,
    label: 'ESCALATE',
    action: 'Call the counterparty; copy their manager on the thread.',
    severity: 'warning',
  },
  3: {
    level: 3,
    label: 'DECIDE',
    action: 'Three weeks of silence. Decide: push to close, or withdraw it.',
    severity: 'critical',
  },
};

export function daysSince(iso: string | Date, now = new Date()): number {
  const then = typeof iso === 'string' ? new Date(iso) : iso;
  const ms = now.getTime() - then.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * Which rung a contract is on. Only contracts genuinely waiting on someone
 * escalate: a draft we have not sent is our own to finish, not a chase.
 */
export function escalationFor(
  status: ContractStatus,
  statusChangedAt: string | Date,
  now = new Date(),
): EscalationStep {
  if (status !== 'out_for_signature' && status !== 'awaiting_my_signature') return LADDER[0];

  const days = daysSince(statusChangedAt, now);
  if (days >= ESCALATION_DAYS[2]) return LADDER[3];
  if (days >= ESCALATION_DAYS[1]) return LADDER[2];
  if (days >= ESCALATION_DAYS[0]) return LADDER[1];
  return LADDER[0];
}

/** Spec 9.4 — renewal alerts, counted back from the end date. */
export const RENEWAL_NOTICE_DAYS = [90, 60, 30, 14, 7] as const;

export interface RenewalState {
  daysToExpiry: number | null;
  /** The notice window this contract has crossed, or null if none yet. */
  noticeWindow: number | null;
  expired: boolean;
  /** True when the notice period to cancel is about to close — the expensive case. */
  noticeDeadlinePassed: boolean;
}

export function renewalState(
  endDate: string | null,
  noticePeriodDays: number | null,
  now = new Date(),
): RenewalState {
  if (!endDate) {
    return { daysToExpiry: null, noticeWindow: null, expired: false, noticeDeadlinePassed: false };
  }

  const end = new Date(`${endDate}T00:00:00Z`);
  const daysToExpiry = Math.floor((end.getTime() - now.getTime()) / 86_400_000);
  // The tightest window crossed, not the widest: RENEWAL_NOTICE_DAYS runs
  // descending, so scanning it forwards would report "90 days" right up to the
  // day a contract expires and the alert would never tighten.
  const noticeWindow =
    [...RENEWAL_NOTICE_DAYS].reverse().find((d) => daysToExpiry <= d && daysToExpiry >= 0) ?? null;

  // An auto-renewing contract has to be cancelled before its notice period
  // closes; miss that and the company is committed for another term.
  const noticeDeadlinePassed =
    noticePeriodDays !== null && daysToExpiry >= 0 && daysToExpiry < noticePeriodDays;

  return { daysToExpiry, noticeWindow, expired: daysToExpiry < 0, noticeDeadlinePassed };
}

export interface ContractRecord {
  id: string;
  counterparty: string;
  category: ContractCategory | null;
  docType: string;
  status: ContractStatus;
  statusChangedAt: string;
  endDate: string | null;
  noticePeriodDays: number | null;
  valueCents: number | null;
  owner: string | null;
  deptCode: string | null;
  driveFolderPath: string | null;
  /** Set when the classification came from a rule rather than a person. */
  needsReview: boolean;
  sourceUrl: string | null;
}
