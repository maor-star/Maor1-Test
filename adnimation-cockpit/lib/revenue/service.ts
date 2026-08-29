import { createRevenueAdapter } from '@/lib/integrations/revenue';
import { toRevenueFacts } from './normalize';
import { latestCompleteDate, summariseRevenue, type Basis, type RevenueSummary } from './summary';
import type { RevenueFact } from './types';

/** How much history the baseline needs: 28 days plus a week of comparisons. */
const HISTORY_DAYS = 35;

const shift = (isoDate: string, days: number) =>
  new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

export async function loadRevenueFacts(today: string): Promise<RevenueFact[]> {
  const adapter = await createRevenueAdapter();
  const rows = await adapter.fetchDailyRevenue(shift(today, -HISTORY_DAYS), today);
  return toRevenueFacts(rows);
}

export interface RevenueView {
  summary: RevenueSummary | null;
  /** The most recent complete day; today is always partial. */
  date: string | null;
  facts: RevenueFact[];
}

export async function loadRevenueView(today: string, basis: Basis = 'net'): Promise<RevenueView> {
  const facts = await loadRevenueFacts(today);
  const date = latestCompleteDate(facts, today);
  return {
    facts,
    date,
    summary: date ? summariseRevenue(facts, date, basis) : null,
  };
}
