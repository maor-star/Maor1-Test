import { differenceInCalendarDays } from 'date-fns';
import type { TaskPriority } from '@/lib/tasks/types';

/**
 * Heat Score — spec 6.2.
 *
 *   Heat = 40×(priority) + 25×(days overdue, normalised) + 20×(money impact)
 *        + 10×(people blocked) + 5×(am I the sole owner)
 *
 * Each term is a 0..1 factor scaled by its weight, so the total lands in 0..100.
 * The score exists to sort the morning brief, not to be a precise measurement —
 * ties are expected and fine.
 */

export const HEAT_WEIGHTS = {
  priority: 40,
  overdue: 25,
  money: 20,
  blocked: 10,
  soleOwner: 5,
} as const;

/** Days overdue is normalised against this cap; 14+ days late is "as late as it gets". */
export const OVERDUE_SATURATION_DAYS = 14;
/** Money impact is normalised against this cap: $50,000 in cents. */
export const MONEY_SATURATION_CENTS = 5_000_000;
/** Blocking this many people saturates the term. */
export const BLOCKED_SATURATION_PEOPLE = 5;

const PRIORITY_FACTOR: Record<TaskPriority, number> = {
  P0: 1,
  P1: 0.7,
  P2: 0.35,
  P3: 0.1,
};

export interface HeatInput {
  priority: TaskPriority;
  dueDate: Date | string | null;
  moneyImpactCents: number | null;
  blockedPeopleCount: number;
  /** True when the CEO is the only owner — nobody else will pick it up. */
  isSoleOwner: boolean;
  /** Injected so the score is deterministic in tests. */
  now?: Date;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export function daysOverdue(dueDate: Date | string | null, now: Date): number {
  if (!dueDate) return 0;
  const due = typeof dueDate === 'string' ? new Date(`${dueDate}T00:00:00Z`) : dueDate;
  if (Number.isNaN(due.getTime())) return 0;
  const diff = differenceInCalendarDays(now, due);
  return diff > 0 ? diff : 0;
}

export interface HeatBreakdown {
  score: number;
  terms: { priority: number; overdue: number; money: number; blocked: number; soleOwner: number };
}

/** Returns the score plus each weighted term, so the UI can explain the number. */
export function heatBreakdown(input: HeatInput): HeatBreakdown {
  const now = input.now ?? new Date();

  const priority = PRIORITY_FACTOR[input.priority] * HEAT_WEIGHTS.priority;
  const overdue =
    clamp01(daysOverdue(input.dueDate, now) / OVERDUE_SATURATION_DAYS) * HEAT_WEIGHTS.overdue;
  const money =
    clamp01((input.moneyImpactCents ?? 0) / MONEY_SATURATION_CENTS) * HEAT_WEIGHTS.money;
  const blocked =
    clamp01(input.blockedPeopleCount / BLOCKED_SATURATION_PEOPLE) * HEAT_WEIGHTS.blocked;
  const soleOwner = input.isSoleOwner ? HEAT_WEIGHTS.soleOwner : 0;

  const total = priority + overdue + money + blocked + soleOwner;
  return {
    score: Math.round(clamp01(total / 100) * 100),
    terms: { priority, overdue, money, blocked, soleOwner },
  };
}

export function heatScore(input: HeatInput): number {
  return heatBreakdown(input).score;
}

/** Cockpit strip 2 bands: which tasks are literally on fire. */
export type HeatBand = 'burning' | 'hot' | 'warm' | 'cool';

export function heatBand(score: number): HeatBand {
  if (score >= 75) return 'burning';
  if (score >= 50) return 'hot';
  if (score >= 25) return 'warm';
  return 'cool';
}
