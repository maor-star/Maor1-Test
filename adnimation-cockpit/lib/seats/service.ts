/**
 * Seats — the demand and supply endpoints the exchange runs on.
 *
 * A demand seat is a DSP buying through us. A supply seat is an SSP endpoint
 * sending us inventory. Both are read-only from the Ad Ops Architect system's
 * own economics tables, so revenue, cost and profit are the source's figures,
 * not a recomputation.
 *
 * The CEO set two thresholds, and they are the point of the screen:
 *  - every seat should be moving $15,000 a day in revenue;
 *  - a supply seat must be spending more than $2,000 a day to be worth running.
 *
 * Health is measured against those, not against a curve fitted to what the
 * seats happen to be doing — a seat at 3% of target is unhealthy however many
 * of its neighbours are too.
 */

export type SeatSide = 'demand' | 'supply';

/** Spec targets, set by the CEO. Money in cents. */
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
  rev1dCents: number;
  cost1dCents: number;
  profit1dCents: number;
  /** Average per day across the window — the figure the target is judged on. */
  revPerDayCents: number;
  costPerDayCents: number;
  profitPerDayCents: number;
  rev30dCents: number;
  cost30dCents: number;
  profit30dCents: number;
  impressions30d: number;
  activeDays30d: number;
  endpoints: number;
  /** Net take on this seat: profit as a share of what it moved. */
  marginPct: number | null;
  /** Where the seat sits against the $15k/day revenue target, 0..1+ */
  targetRatio: number;
  /** Supply only: does it clear the $2,000/day spend floor? */
  clearsSpendFloor: boolean | null;
  /** 0–100. What the colour on the map means. */
  health: number;
  status: SeatStatus;
  /** Why it scores what it scores, in one line. */
  because: string;
  /** Change in daily revenue: the last day against the 7-day average. */
  trendPct: number | null;
}

export interface SeatSideView {
  side: SeatSide;
  seats: Seat[];
  totals: {
    seats: number;
    onTarget: number;
    dormant: number;
    revPerDayCents: number;
    costPerDayCents: number;
    profitPerDayCents: number;
    /** Supply only: how many clear the spend floor. */
    clearingFloor: number;
  };
}

interface Snapshot {
  demand: Seat[];
  supply: Seat[];
  lastDay: string;
  windowDays: number;
  pulledAt: string;
}

let cache: Snapshot | null = null;

const pct = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

/**
 * Health, 0–100, from three things the CEO can act on:
 *   60 — how close the seat is to the $15k/day revenue target;
 *   25 — how much of the window it actually traded on (a seat that ran four
 *        days out of thirty is not a working seat, however good those days);
 *   15 — margin, because volume at no margin is not worth the integration.
 * A supply seat below the $2,000/day spend floor is capped, whatever else it
 * scores: the floor is a condition of keeping the seat, not a soft signal.
 */
function scoreSeat(s: {
  revPerDayCents: number;
  activeDays30d: number;
  windowDays: number;
  marginPct: number | null;
  side: SeatSide;
  clearsSpendFloor: boolean | null;
}): { health: number; status: SeatStatus; because: string } {
  const targetRatio = s.revPerDayCents / SEAT_REVENUE_TARGET_CENTS;
  const reach = Math.min(1, targetRatio);
  const consistency = s.windowDays > 0 ? Math.min(1, s.activeDays30d / s.windowDays) : 0;
  const margin = Math.min(1, Math.max(0, (s.marginPct ?? 0) / 0.4));

  let health = Math.round(reach * 60 + consistency * 25 + margin * 15);

  if (s.side === 'supply' && s.clearsSpendFloor === false) {
    // Below the floor the seat is a candidate for closing, so it must never
    // read as healthy on the strength of a good margin on tiny volume.
    health = Math.min(health, 45);
  }

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
      ? 'No revenue on the last day.'
      : s.side === 'supply' && s.clearsSpendFloor === false
        ? `Under the $2,000/day spend floor · ${(targetRatio * 100).toFixed(0)}% of the revenue target`
        : `${(targetRatio * 100).toFixed(0)}% of the $15k/day target · traded ${s.activeDays30d}/${s.windowDays} days`;

  return { health: Math.max(0, Math.min(100, health)), status, because };
}

function build(
  rows: (string | number)[][],
  side: SeatSide,
  windowDays: number,
): Seat[] {
  return rows
    .map((r) => {
      const seat = r[0] as string;
      const company = r[1] as string;
      const rev1dCents = r[2] as number;
      const cost1dCents = r[3] as number;
      const rev7dCents = r[4] as number;
      const rev30dCents = r[6] as number;
      const cost30dCents = r[7] as number;
      const profit30dCents = r[8] as number;
      const impressions30d = r[9] as number;
      const activeDays30d = r[10] as number;
      const endpoints = r[11] as number;

      const revPerDayCents = Math.round(rev30dCents / windowDays);
      const costPerDayCents = Math.round(cost30dCents / windowDays);
      const profitPerDayCents = Math.round(profit30dCents / windowDays);
      const marginPct = pct(profit30dCents, rev30dCents);

      const clearsSpendFloor = side === 'supply' ? costPerDayCents >= SUPPLY_SPEND_FLOOR_CENTS : null;

      const { health, status, because } = scoreSeat({
        revPerDayCents,
        activeDays30d,
        windowDays,
        marginPct,
        side,
        clearsSpendFloor,
      });

      // The last day against the seat's own recent run rate.
      const sevenDayAvg = Math.round(rev7dCents / 7);
      const trendPct = sevenDayAvg > 0 ? (rev1dCents - sevenDayAvg) / sevenDayAvg : null;

      return {
        seat,
        company,
        side,
        rev1dCents,
        cost1dCents,
        profit1dCents: rev1dCents - cost1dCents,
        revPerDayCents,
        costPerDayCents,
        profitPerDayCents,
        rev30dCents,
        cost30dCents,
        profit30dCents,
        impressions30d,
        activeDays30d,
        endpoints,
        marginPct,
        targetRatio: revPerDayCents / SEAT_REVENUE_TARGET_CENTS,
        clearsSpendFloor,
        health,
        status,
        because,
        trendPct,
      };
    })
    .sort((a, b) => b.rev30dCents - a.rev30dCents);
}

async function load(): Promise<Snapshot> {
  if (cache) return cache;
  const snap = (await import('@/fixtures/xe-seats.json')).default;
  cache = {
    demand: build(snap.demand, 'demand', snap.windowDays),
    supply: build(snap.supply, 'supply', snap.windowDays),
    lastDay: snap.lastDay,
    windowDays: snap.windowDays,
    pulledAt: snap.pulledAt,
  };
  return cache;
}

function summarise(seats: Seat[], side: SeatSide): SeatSideView {
  return {
    side,
    seats,
    totals: {
      seats: seats.length,
      onTarget: seats.filter((s) => s.status === 'on_target').length,
      dormant: seats.filter((s) => s.status === 'dormant').length,
      revPerDayCents: seats.reduce((a, s) => a + s.revPerDayCents, 0),
      costPerDayCents: seats.reduce((a, s) => a + s.costPerDayCents, 0),
      profitPerDayCents: seats.reduce((a, s) => a + s.profitPerDayCents, 0),
      clearingFloor: seats.filter((s) => s.clearsSpendFloor === true).length,
    },
  };
}

export async function loadSeats(side: SeatSide): Promise<SeatSideView & {
  lastDay: string;
  windowDays: number;
  pulledAt: string;
}> {
  const snap = await load();
  const seats = side === 'demand' ? snap.demand : snap.supply;
  return {
    ...summarise(seats, side),
    lastDay: snap.lastDay,
    windowDays: snap.windowDays,
    pulledAt: snap.pulledAt,
  };
}

/** Both sides at once, for the cockpit strip and the map. */
export async function loadAllSeats() {
  const snap = await load();
  return {
    demand: summarise(snap.demand, 'demand'),
    supply: summarise(snap.supply, 'supply'),
    lastDay: snap.lastDay,
    windowDays: snap.windowDays,
    pulledAt: snap.pulledAt,
  };
}

/**
 * The gap to target across a side: what it would take to get every seat to
 * $15k/day. Stated as a number rather than a chart because it is the one figure
 * that says how far off the plan is.
 */
export function gapToTargetCents(seats: Seat[]): number {
  return seats.reduce(
    (a, s) => a + Math.max(0, SEAT_REVENUE_TARGET_CENTS - s.revPerDayCents),
    0,
  );
}
