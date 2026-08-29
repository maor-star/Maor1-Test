import { heatScore } from '@/lib/scoring/heat-score';
import { daysSince, escalationFor, renewalState, type ContractRecord } from '@/lib/contracts/status';
import type { TaskPriority } from '@/lib/tasks/types';

/**
 * The cadence — one ordered list of what to do next.
 *
 * The cockpit's job is not to show six panels and let the CEO work out the
 * order. It is to answer "what now", then "what after that". Everything that
 * can demand action — a task, a contract going quiet, a renewal about to
 * auto-extend, a delegation nobody has touched, a revenue anomaly — becomes an
 * item with a verb and a position in one queue.
 *
 * Each item carries the verb, because "PubMatic renewal" is not an instruction
 * and "Call PubMatic before the notice period closes" is.
 */

export const ACTIONS = ['CALL', 'REVIEW', 'SIGN', 'RESOLVE', 'DECIDE', 'CHASE', 'CLOSE'] as const;
export type CadenceAction = (typeof ACTIONS)[number];

export type CadenceSource = 'task' | 'contract' | 'renewal' | 'delegation' | 'revenue';

export interface CadenceItem {
  id: string;
  action: CadenceAction;
  /** The imperative, written as the CEO would say it to himself. */
  title: string;
  /** Why it is here, in one line. */
  because: string;
  source: CadenceSource;
  /** 0–100. Drives the order; ties broken by money at stake. */
  urgency: number;
  moneyAtStakeCents: number | null;
  dueLabel: string | null;
  deptCode: string | null;
  href: string;
  /** Whether this is genuinely the CEO's, or could be handed to someone. */
  delegable: boolean;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface TaskInput {
  id: string;
  title: string;
  priority: TaskPriority;
  dueDate: string | null;
  moneyImpactCents: number | null;
  blockedPeopleCount: number;
  ownerIsMe: boolean;
  deptCode: string | null;
  isMine: boolean;
  status: string;
}

export interface DelegationInput {
  id: string;
  what: string;
  person: string;
  lastMovementAt: string;
  status: string;
}

export interface RevenueAnomalyInput {
  id: string;
  label: string;
  what: string;
  severity: 'critical' | 'warning' | 'watch';
  moneyImpactCents: number;
  deptCode: string | null;
}

// ---------------------------------------------------------------------------
// Builders — one per source, each deciding the verb and the urgency
// ---------------------------------------------------------------------------

function fromTask(t: TaskInput, now: Date): CadenceItem | null {
  if (t.status === 'done') return null;

  const heat = heatScore({
    priority: t.priority,
    dueDate: t.dueDate,
    moneyImpactCents: t.moneyImpactCents,
    blockedPeopleCount: t.blockedPeopleCount,
    isSoleOwner: t.ownerIsMe,
    now,
  });

  // A task naming a person or a meeting is a call; the rest is work to close.
  // `\b` only recognises ASCII word characters, so the Hebrew terms are matched
  // as plain substrings rather than being silently skipped.
  const wantsCall =
    /\b(call|meet|speak|talk|follow up)\b/i.test(t.title) ||
    /(לתאם|שיחה|פגישה|להתקשר|לדבר עם)/.test(t.title);

  return {
    id: `task:${t.id}`,
    action: wantsCall ? 'CALL' : 'CLOSE',
    title: t.title,
    because:
      t.dueDate && t.dueDate < now.toISOString().slice(0, 10)
        ? `${t.priority} · ${daysSince(`${t.dueDate}T00:00:00Z`, now)} days overdue`
        : `${t.priority} · due ${t.dueDate ?? 'unscheduled'}`,
    source: 'task',
    urgency: heat,
    moneyAtStakeCents: t.moneyImpactCents,
    dueLabel: t.dueDate,
    deptCode: t.deptCode,
    href: `/tasks/${t.id}`,
    delegable: t.isMine,
  };
}

function fromContract(c: ContractRecord, now: Date): CadenceItem | null {
  const step = escalationFor(c.status, c.statusChangedAt, now);

  if (c.status === 'awaiting_my_signature') {
    return {
      id: `contract:${c.id}`,
      action: 'SIGN',
      title: `Sign the ${c.docType} with ${c.counterparty}`,
      because: `Waiting on me for ${daysSince(c.statusChangedAt, now)} days`,
      source: 'contract',
      // Anything waiting on the CEO alone outranks work that is moving.
      urgency: clamp(80 + daysSince(c.statusChangedAt, now) * 2),
      moneyAtStakeCents: c.valueCents,
      dueLabel: null,
      deptCode: c.deptCode,
      href: `/contracts#${c.id}`,
      delegable: false,
    };
  }

  if (c.status === 'out_for_signature' && step.level > 0) {
    return {
      id: `contract:${c.id}`,
      action: step.level >= 3 ? 'DECIDE' : 'CHASE',
      title:
        step.level >= 3
          ? `Decide on the ${c.docType} with ${c.counterparty}`
          : `Chase ${c.counterparty} on the ${c.docType}`,
      because: `Out for signature ${daysSince(c.statusChangedAt, now)} days · ${step.action}`,
      source: 'contract',
      urgency: clamp(45 + step.level * 15),
      moneyAtStakeCents: c.valueCents,
      dueLabel: null,
      deptCode: c.deptCode,
      href: `/contracts#${c.id}`,
      delegable: true,
    };
  }

  if (c.needsReview) {
    return {
      id: `contract:${c.id}`,
      action: 'REVIEW',
      title: `Confirm how ${c.counterparty} is filed`,
      because: 'Classified by rule, not confirmed by a person',
      source: 'contract',
      urgency: 30,
      moneyAtStakeCents: c.valueCents,
      dueLabel: null,
      deptCode: c.deptCode,
      href: `/contracts#${c.id}`,
      delegable: true,
    };
  }

  return null;
}

function fromRenewal(c: ContractRecord, now: Date): CadenceItem | null {
  if (c.status !== 'signed') return null;
  const r = renewalState(c.endDate, c.noticePeriodDays, now);
  if (r.expired || r.noticeWindow === null) return null;

  // Passing the notice deadline commits the company to another term, so that
  // case outranks an ordinary renewal reminder.
  const urgent = r.noticeDeadlinePassed;

  return {
    id: `renewal:${c.id}`,
    action: urgent ? 'DECIDE' : 'REVIEW',
    title: urgent
      ? `Decide on ${c.counterparty} before it auto-renews`
      : `Review the ${c.counterparty} renewal`,
    because: urgent
      ? `Notice period closes in ${r.daysToExpiry} days — after that it renews automatically`
      : `Expires in ${r.daysToExpiry} days`,
    source: 'renewal',
    urgency: urgent ? clamp(90 - (r.daysToExpiry ?? 0)) : clamp(60 - (r.daysToExpiry ?? 0) / 2),
    moneyAtStakeCents: c.valueCents,
    dueLabel: c.endDate,
    deptCode: c.deptCode,
    href: `/contracts#${c.id}`,
    delegable: !urgent,
  };
}

function fromDelegation(d: DelegationInput, now: Date): CadenceItem | null {
  if (d.status === 'done') return null;
  const quiet = daysSince(d.lastMovementAt, now);
  if (quiet < 3) return null;

  return {
    id: `delegation:${d.id}`,
    action: 'CHASE',
    title: `Chase ${d.person} on "${d.what}"`,
    because: `No movement for ${quiet} days`,
    source: 'delegation',
    urgency: clamp(35 + quiet * 3),
    moneyAtStakeCents: null,
    dueLabel: null,
    deptCode: null,
    href: '/delegations',
    delegable: false,
  };
}

function fromAnomaly(a: RevenueAnomalyInput): CadenceItem {
  const base = { critical: 85, warning: 60, watch: 40 }[a.severity];
  return {
    id: `revenue:${a.id}`,
    action: 'RESOLVE',
    title: `Resolve the drop in ${a.label}`,
    because: a.what,
    source: 'revenue',
    urgency: base,
    moneyAtStakeCents: a.moneyImpactCents,
    dueLabel: null,
    deptCode: a.deptCode,
    href: '/revenue',
    delegable: true,
  };
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface CadenceInputs {
  tasks: TaskInput[];
  contracts: ContractRecord[];
  delegations: DelegationInput[];
  anomalies: RevenueAnomalyInput[];
}

/**
 * Builds the ordered queue. Sorted by urgency, then by money at stake — when
 * two things are equally pressing, the expensive one goes first.
 */
export function buildCadence(inputs: CadenceInputs, now = new Date()): CadenceItem[] {
  const items: CadenceItem[] = [];

  for (const t of inputs.tasks) {
    const item = fromTask(t, now);
    if (item) items.push(item);
  }
  for (const c of inputs.contracts) {
    const item = fromContract(c, now);
    if (item) items.push(item);
    const renewal = fromRenewal(c, now);
    if (renewal) items.push(renewal);
  }
  for (const d of inputs.delegations) {
    const item = fromDelegation(d, now);
    if (item) items.push(item);
  }
  for (const a of inputs.anomalies) items.push(fromAnomaly(a));

  return items.sort(
    (a, b) =>
      b.urgency - a.urgency ||
      (b.moneyAtStakeCents ?? 0) - (a.moneyAtStakeCents ?? 0) ||
      a.title.localeCompare(b.title),
  );
}

/**
 * Splits the queue into what to do now and what comes after.
 *
 * A list of forty things is not a cadence, it is the backlog with a new name.
 * `now` is capped so the top of the screen is always a short, finishable list.
 */
export function splitCadence(items: CadenceItem[], nowCount = 5) {
  return {
    now: items.slice(0, nowCount),
    next: items.slice(nowCount, nowCount + 10),
    laterCount: Math.max(0, items.length - nowCount - 10),
  };
}
