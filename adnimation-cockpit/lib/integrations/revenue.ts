import { z } from 'zod';
import { arsRowSchema, type ArsRow } from '@/lib/revenue/types';

/**
 * Revenue source — the Ad Ops Architect project's PostgreSQL (spec question
 * 21.1, now answered).
 *
 * ACCESS IS READ-ONLY. The cockpit is a reader of that system, never a writer:
 * it is the operational system the ad ops team works in, and a stray write from
 * a reporting tool would corrupt live revenue records. Enforced three ways —
 * the query below is a single SELECT, the adapter exposes no write method, and
 * `ARS_DATABASE_URL` is expected to point at a read-only role.
 */

export interface RevenueAdapter {
  readonly name: 'revenue';
  /** Daily revenue by demand category and business line, inclusive of both dates. */
  fetchDailyRevenue(fromDate: string, toDate: string): Promise<ArsRow[]>;
}

/** The one query this integration runs. Kept here so it is reviewable at a glance. */
export const ARS_DAILY_QUERY = `
  SELECT r.report_date::text                      AS date,
         r.category                                AS category,
         a.is_trading_account                      AS trading,
         round(sum(r.gross_revenue) * 100)::bigint AS gross_cents,
         round(sum(r.source_fee)    * 100)::bigint AS fee_cents,
         sum(r.impressions)::bigint                AS impressions
    FROM ars_site_daily_revenue r
    JOIN ars_accounts a ON a.ars_id = r.ars_account_id
   WHERE r.report_date BETWEEN $1::date AND $2::date
   GROUP BY 1, 2, 3
   ORDER BY 1, 2, 3
`;

const dbRowSchema = z.object({
  date: z.string(),
  category: z.string(),
  trading: z.boolean(),
  gross_cents: z.union([z.string(), z.number()]),
  fee_cents: z.union([z.string(), z.number()]),
  impressions: z.union([z.string(), z.number()]),
});

const toInt = (v: string | number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

export function normaliseArsRow(raw: unknown): ArsRow | null {
  const parsed = dbRowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  const row = {
    date: d.date.slice(0, 10),
    category: d.category,
    trading: d.trading,
    grossCents: toInt(d.gross_cents),
    feeCents: toInt(d.fee_cents),
    impressions: toInt(d.impressions),
  };
  return arsRowSchema.safeParse(row).success ? row : null;
}

class ArsRevenueAdapter implements RevenueAdapter {
  readonly name = 'revenue' as const;

  constructor(private readonly connectionString: string) {}

  async fetchDailyRevenue(fromDate: string, toDate: string): Promise<ArsRow[]> {
    // Imported lazily so the fake path never opens a second connection pool.
    const { default: postgres } = await import('postgres');
    const sql = postgres(this.connectionString, { max: 2, idle_timeout: 20 });
    try {
      const raw = await sql.unsafe(ARS_DAILY_QUERY, [fromDate, toDate]);
      return raw
        .map(normaliseArsRow)
        .filter((r): r is ArsRow => r !== null);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}

/**
 * Serves the checked-in snapshot pulled from the source on 2026-08-29. Lets the
 * app, the tests and a local dev run work without credentials to a production
 * revenue system.
 */
export class SnapshotRevenueAdapter implements RevenueAdapter {
  readonly name = 'revenue' as const;

  constructor(private readonly rows: ArsRow[]) {}

  static async load(): Promise<SnapshotRevenueAdapter> {
    const snapshot = (await import('@/fixtures/ars-revenue-snapshot.json')).default;
    const rows = snapshot.rows
      .map((r: unknown[]) =>
        normaliseArsRow({
          date: r[0], category: r[1], trading: r[2],
          gross_cents: r[3], fee_cents: r[4], impressions: r[5],
        }),
      )
      .filter((r): r is ArsRow => r !== null);
    return new SnapshotRevenueAdapter(rows);
  }

  async fetchDailyRevenue(fromDate: string, toDate: string): Promise<ArsRow[]> {
    return this.rows.filter((r) => r.date >= fromDate && r.date <= toDate);
  }
}

export function createRevenueAdapter(): RevenueAdapter | Promise<RevenueAdapter> {
  const url = process.env.ARS_DATABASE_URL;
  if (process.env.USE_FAKE_INTEGRATIONS === '1' || !url) return SnapshotRevenueAdapter.load();
  return new ArsRevenueAdapter(url);
}
