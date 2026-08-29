import { PERIODS, type Period } from '@/lib/revenue/periods';

/**
 * Seats — the demand and supply endpoints the exchange runs on.
 *
 * A demand seat is a DSP buying through us; a supply seat is an SSP endpoint
 * sending us inventory. Both come read-only from the source's own economics
 * tables, so revenue, cost and profit are its figures, not a recomputation.
 *
 * The CEO set two thresholds, and they are the point of the screen:
 *  - every seat should be moving $15,000 a day in revenue;
 *  - a supply seat must be spending more than $2,000 a day to be worth running.
 *
 * Both are per-day rates, so they are comparable in every window: a seat is
 * judged on what it averages per day, not on what a 30-day total happens to add
 * up to.
 */

export type SeatSide = 'demand' | 'supply';

/** Targets, set by the CEO. Money in cents, per day. */
export const SEAT_REVENUE_TARGET_CENTS = 15_000_00;
export const SUPPLY_SPEND_FLOOR_CENTS = 2_000_00;

export const SEAT_STATUSES = ['on_target', 'building', 'below', 'dormant'] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

export const STATUS_LABEL: Record<SeatStatus, string> = {
  on_target: 'ON TARGET',
  building: 'BUILDING',
  below: 'BELOW TARGET',
  dormant: 'DORMANT',
};

export interface Seat {
  seat: string;
  company: string;
  side: SeatSide;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  impressions: number;
  endpoints: number;
  activeDays: number;
  /** Per-day rates — what the targets are judged on. */
  revPerDayCents: number;
  costPerDayCents: number;
  profitPerDayCents: number;
  marginPct: number | null;
  targetRatio: number;
  clearsSpendFloor: boolean | null;
  health: number;
  status: SeatStatus;
  because: string;
}

export interface SeatSideView {
  side: SeatSide;
  period: Period;
  seats: Seat[];
  /** Days in the window that the source actually has rows for. */
  windowDays: number;
  totals: {
    seats: number;
    onTarget: number;
    dormant: number;
    revenueCents: number;
    costCents: number;
    profitCents: number;
    revPerDayCents: number;
    costPerDayCents: number;
    profitPerDayCents: number;
    clearingFloor: number;
  };
  meta: {
    lastCompleteDay: string;
    partialDay: string;
    coverageFrom: string;
    pulledAt: string;
  };
  /** Set when the source has no rows for this window at all. */
  empty: boolean;
}

/** Nominal length of each window, used to turn a total into a per-day rate. */
const WINDOW_DAYS: Record<string, number> = {
  TODAY: 1,
  YESTERDAY: 1,
  '7D': 7,
  '30D': 30,
  MTD: 28,
  QTD: 59,
  LAST_Q: 91,
  YTD: 240,
};

interface Snapshot {
  demand: Map<string, Seat[]>;
  supply: Map<string, Seat[]>;
  meta: SeatSideView['meta'];
  windowDays: Record<string, number>;
}

let cache: Snapshot | null = null;

/**
 * Health, 0–100, from three things the CEO can act on:
 *   60 — how close the seat is to the $15k/day revenue target;
 *   25 — how much of the window it actually traded on (a seat that ran four
 *        days out of thirty is not a working seat, however good those days);
 *   15 — margin, because volume at no margin is not worth the integration.
 * A supply seat under the $2,000/day spend floor is capped: the floor is a
 * condition of keeping the seat, not a soft signal.
 */
function score(s: {
  revPerDayCents: number;
  activeDays: number;
  windowDays: number;
  marginPct: number | null;
  side: SeatSide;
  clearsSpendFloor: boolean | null;
}): { health: number; status: SeatStatus; because: string } {
  const targetRatio = s.revPerDayCents / SEAT_REVENUE_TARGET_CENTS;
  const reach = Math.min(1, targetRatio);
  const consistency = s.windowDays > 0 ? Math.min(1, s.activeDays / s.windowDays) : 0;
  const margin = Math.min(1, Math.max(0, (s.marginPct ?? 0) / 0.4));

  let health = Math.round(reach * 60 + consistency * 25 + margin * 15);
  if (s.side === 'supply' && s.clearsSpendFloor === false) health = Math.min(health, 45);

  const status: SeatStatus =
    s.revPerDayCents <= 0
      ? 'dormant'
      : targetRatio >= 1
        ? 'on_target'
        : targetRatio >= 0.25
          ? 'building'
          : 'below';

  const because =
    status === 'dormant'
      ? 'No revenue in this window.'
      : s.side === 'supply' && s.clearsSpendFloor === false
        ? `Under the $2,000/day spend floor · ${(targetRatio * 100).toFixed(0)}% of the revenue target`
        : `${(targetRatio * 100).toFixed(0)}% of the $15k/day target · traded ${s.activeDays}/${s.windowDays} days`;

  return { health: Math.max(0, Math.min(100, health)), status, because };
}

function build(rows: (string | number)[][], side: SeatSide, windowDays: Record<string, number>) {
  const byWindow = new Map<string, Seat[]>();

  for (const r of rows) {
    const window = r[0] as string;
    const days = windowDays[window] ?? 1;
    const revenueCents = r[3] as number;
    const costCents = r[4] as number;
    const profitCents = revenueCents - costCents;
    const activeDays = r[7] as number;

    const revPerDayCents = Math.round(revenueCents / days);
    const costPerDayCents = Math.round(costCents / days);
    const marginPct = revenueCents > 0 ? profitCents / revenueCents : null;
    const clearsSpendFloor = side === 'supply' ? costPerDayCents >= SUPPLY_SPEND_FLOOR_CENTS : null;

    const { health, status, because } = score({
      revPerDayCents,
      activeDays,
      windowDays: days,
      marginPct,
      side,
      clearsSpendFloor,
    });

    const seat: Seat = {
      seat: r[1] as string,
      company: r[2] as string,
      side,
      revenueCents,
      costCents,
      profitCents,
      impressions: r[5] as number,
      endpoints: r[6] as number,
      activeDays,
      revPerDayCents,
      costPerDayCents,
      profitPerDayCents: Math.round(profitCents / days),
      marginPct,
      targetRatio: revPerDayCents / SEAT_REVENUE_TARGET_CENTS,
      clearsSpendFloor,
      health,
      status,
      because,
    };

    byWindow.set(window, [...(byWindow.get(window) ?? []), seat]);
  }

  for (const seats of byWindow.values()) seats.sort((a, b) => b.revenueCents - a.revenueCents);
  return byWindow;
}

async function load(): Promise<Snapshot> {
  if (cache) return cache;
  const snap = (await import('@/fixtures/xe-seats.json')).default;

  cache = {
    demand: build(snap.demand, 'demand', WINDOW_DAYS),
    supply: build(snap.supply, 'supply', WINDOW_DAYS),
    meta: {
      lastCompleteDay: snap.lastCompleteDay,
      partialDay: snap.partialDay,
      coverageFrom: snap.coverageFrom,
      pulledAt: snap.pulledAt,
    },
    windowDays: WINDOW_DAYS,
  };
  return cache;
}

/** Which windows the source actually has seat rows for. */
export async function availableSeatPeriods(): Promise<Period[]> {
  const snap = await load();
  return PERIODS.filter((p) => (snap.demand.get(p)?.length ?? 0) + (snap.supply.get(p)?.length ?? 0) > 0);
}

export async function loadSeats(side: SeatSide, period: Period = '30D'): Promise<SeatSideView> {
  const snap = await load();
  const seats = (side === 'demand' ? snap.demand : snap.supply).get(period) ?? [];
  const windowDays = snap.windowDays[period] ?? 1;

  return {
    side,
    period,
    seats,
    windowDays,
    empty: seats.length === 0,
    totals: {
      seats: seats.length,
      onTarget: seats.filter((s) => s.status === 'on_target').length,
      dormant: seats.filter((s) => s.status === 'dormant').length,
      revenueCents: seats.reduce((a, s) => a + s.revenueCents, 0),
      costCents: seats.reduce((a, s) => a + s.costCents, 0),
      profitCents: seats.reduce((a, s) => a + s.profitCents, 0),
      revPerDayCents: seats.reduce((a, s) => a + s.revPerDayCents, 0),
      costPerDayCents: seats.reduce((a, s) => a + s.costPerDayCents, 0),
      profitPerDayCents: seats.reduce((a, s) => a + s.profitPerDayCents, 0),
      clearingFloor: seats.filter((s) => s.clearsSpendFloor === true).length,
    },
    meta: snap.meta,
  };
}

/** The strongest seats on each side — the overview's "who is carrying us". */
export async function topSeats(period: Period = '30D', n = 5) {
  const [demand, supply] = await Promise.all([loadSeats('demand', period), loadSeats('supply', period)]);
  return {
    demand: demand.seats.slice(0, n),
    supply: supply.seats.slice(0, n),
    period,
    meta: demand.meta,
  };
}

/**
 * The gap to target across a side: what every seat would have to add to reach
 * $15,000 a day. Stated as one number because it is the figure that says how
 * far off the plan is.
 */
export function gapToTargetCents(seats: Seat[]): number {
  return seats.reduce((a, s) => a + Math.max(0, SEAT_REVENUE_TARGET_CENTS - s.revPerDayCents), 0);
}
