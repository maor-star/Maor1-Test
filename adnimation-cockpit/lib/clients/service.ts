import { PERIOD_LABEL, type Period } from '@/lib/revenue/periods';

/**
 * Clients — every account that pays us, in the window you pick.
 *
 * Figures use the source's own publisher formula, so a client's numbers add up
 * to the revenue page rather than to a second, private arithmetic. `profit` is
 * Adnimation's own money on that account: what is left after the source fee and
 * the publisher's rev share.
 *
 * Sorted on profit, not gross. A trading account can be the largest by gross
 * and mid-table by profit, because most of its gross goes straight back out.
 */

/** The windows the account pull covers. */
export const CLIENT_PERIODS = ['YESTERDAY', '7D', '30D'] as const;
export type ClientPeriod = (typeof CLIENT_PERIODS)[number];

export const isClientPeriod = (v: string | undefined): v is ClientPeriod =>
  CLIENT_PERIODS.includes(v as ClientPeriod);

const WINDOW_DAYS: Record<ClientPeriod, number> = { YESTERDAY: 1, '7D': 7, '30D': 30 };

export interface Client {
  name: string;
  isTrading: boolean;
  grossCents: number;
  netAfterFeeCents: number;
  payoutCents: number;
  profitCents: number;
  impressions: number;
  ecpmCents: number | null;
  /** Adnimation's cut as a share of gross. */
  takeRate: number | null;
  profitPerDayCents: number;
  /**
   * Change in daily profit against the 30-day run rate, or null when there is
   * nothing to compare against. Negative means the client is shrinking.
   */
  trendPct: number | null;
}

export interface ClientBook {
  period: ClientPeriod;
  label: string;
  clients: Client[];
  windowDays: number;
  totals: {
    grossCents: number;
    profitCents: number;
    impressions: number;
    clientCount: number;
    tradingCount: number;
  };
  lastCompleteDay: string;
  pulledAt: string;
}

interface Row {
  window: string;
  account: string;
  isTrading: boolean;
  grossCents: number;
  netAfterFeeCents: number;
  payoutCents: number;
  profitCents: number;
  impressions: number;
}

let cache: { rows: Row[]; lastCompleteDay: string; pulledAt: string } | null = null;

async function load() {
  if (cache) return cache;
  const snap = (await import('@/fixtures/ars-accounts.json')).default;
  cache = {
    rows: snap.rows.map((r) => ({
      window: r[0] as string,
      account: r[1] as string,
      isTrading: r[2] === 1,
      grossCents: r[3] as number,
      netAfterFeeCents: r[4] as number,
      payoutCents: r[5] as number,
      profitCents: r[6] as number,
      impressions: r[7] as number,
    })),
    lastCompleteDay: snap.lastCompleteDay,
    pulledAt: snap.pulledAt,
  };
  return cache;
}

const ecpm = (profitCents: number, impressions: number) =>
  impressions > 0 ? Math.round((profitCents / impressions) * 1000) : null;

export async function loadClients(period: ClientPeriod = '30D'): Promise<ClientBook> {
  const snap = await load();
  const days = WINDOW_DAYS[period];

  // The 30-day book is the baseline every shorter window is judged against.
  const baseline = new Map<string, number>();
  for (const r of snap.rows) {
    if (r.window === '30D') baseline.set(r.account, Math.round(r.profitCents / 30));
  }

  const clients: Client[] = snap.rows
    .filter((r) => r.window === period)
    .map((r) => {
      const profitPerDayCents = Math.round(r.profitCents / days);
      const base = baseline.get(r.account) ?? 0;
      return {
        name: r.account,
        isTrading: r.isTrading,
        grossCents: r.grossCents,
        netAfterFeeCents: r.netAfterFeeCents,
        payoutCents: r.payoutCents,
        profitCents: r.profitCents,
        impressions: r.impressions,
        ecpmCents: ecpm(r.profitCents, r.impressions),
        takeRate: r.grossCents > 0 ? r.profitCents / r.grossCents : null,
        profitPerDayCents,
        // A 30-day window compared against itself is not a trend, it is zero.
        trendPct: period === '30D' || base <= 0 ? null : (profitPerDayCents - base) / base,
      };
    })
    .sort((a, b) => b.profitCents - a.profitCents);

  return {
    period,
    label: PERIOD_LABEL[period as Period],
    clients,
    windowDays: days,
    totals: {
      grossCents: clients.reduce((a, c) => a + c.grossCents, 0),
      profitCents: clients.reduce((a, c) => a + c.profitCents, 0),
      impressions: clients.reduce((a, c) => a + c.impressions, 0),
      clientCount: clients.length,
      tradingCount: clients.filter((c) => c.isTrading).length,
    },
    lastCompleteDay: snap.lastCompleteDay,
    pulledAt: snap.pulledAt,
  };
}

/**
 * Concentration risk (spec 7.3) — how much of profit comes from the top N.
 * The spec calls this an existential risk measure and asks for it always on.
 */
export function concentration(clients: Client[], topN = 5): number | null {
  const total = clients.reduce((a, c) => a + c.profitCents, 0);
  if (total <= 0) return null;
  return clients.slice(0, topN).reduce((a, c) => a + c.profitCents, 0) / total;
}
