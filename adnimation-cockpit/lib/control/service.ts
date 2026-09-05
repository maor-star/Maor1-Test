import { and, desc, gte, sql } from 'drizzle-orm';
import { activityDaily, companyDaily, coreClientsDaily, db } from '@/lib/db';
import { todayInTz } from '@/lib/utils';
import { addDays, rangeFor, type Period, type PeriodRange } from '@/lib/revenue/periods';
import {
  ACTIVITY_LINES, rankCoreClients, summariseLineOver,
  type ActivityLine, type CoreClient, type CoreClientDay, type LineDay, type LinePeriodSummary,
} from './lines';

/**
 * The control panel, from the tables the activity sync writes.
 *
 * Read, never fetched: the screen reads the local rows and says how old they
 * are. A slow source, a missing credential or a night the job did not run all
 * degrade to yesterday's figures with their age on them, which he can act on,
 * rather than to a panel that is blank or — worse — shows a zero that reads
 * like a collapse.
 */

export interface ControlPanel {
  /** The window every tile is showing, and what it is compared against. */
  period: Period;
  range: PeriodRange;
  lines: LinePeriodSummary[];
  coreClients: CoreClient[];
  /** When the sync last wrote anything, or null when it never has. */
  pulledAt: Date | null;
  /** Whether there is anything at all to show. */
  empty: boolean;
  today: string;
}

/** The core-client ranking always wants five weeks, whatever the tiles show. */
const WINDOW_DAYS = 35;

export async function loadControlPanel(period: Period = '30D'): Promise<ControlPanel> {
  const today = todayInTz();
  // Anchored on yesterday: the last day the source has finished with. TODAY
  // is the one window that deliberately reaches past it.
  const range = rangeFor(period, addDays(today, -1), today);
  const fiveWeeksAgo = addDays(today, -WINDOW_DAYS);
  const since = range.previous.from < fiveWeeksAgo ? range.previous.from : fiveWeeksAgo;

  const [lineRows, clientRows, bidderRows, [meta]] = await Promise.all([
    db.select().from(activityDaily).where(gte(activityDaily.date, since)),
    db.select().from(coreClientsDaily).where(gte(coreClientsDaily.date, since)),
    /*
     * Budder's days.
     *
     * The bidder is one of his seven pillars and the activity source does not
     * report it — the P&L does, day by day, because it is one of the four
     * books. Reading it from there costs one query and keeps the tile telling
     * the truth; the alternative was a seventh tile that said "nothing from
     * the source yet" for ever.
     */
    db
      .select({
        date: companyDaily.date,
        grossCents: companyDaily.bidderGrossCents,
        profitCents: companyDaily.bidderProfitCents,
        impressions: companyDaily.bidderImpressions,
      })
      .from(companyDaily)
      .where(gte(companyDaily.date, since)),
    db
      .select({ pulledAt: sql<Date | null>`max(pulled_at)` })
      .from(activityDaily),
  ]);

  const days: LineDay[] = lineRows
    .filter((r): r is typeof r & { line: ActivityLine } =>
      (ACTIVITY_LINES as readonly string[]).includes(r.line),
    )
    .map((r) => ({
      line: r.line,
      date: r.date,
      grossCents: r.grossCents,
      profitCents: r.profitCents,
      impressions: r.impressions,
      entities: r.entities,
    }));

  for (const r of bidderRows) {
    days.push({
      line: 'bidder',
      date: r.date,
      grossCents: r.grossCents,
      profitCents: r.profitCents,
      impressions: r.impressions,
      entities: null,
    });
  }

  const clients: CoreClientDay[] = clientRows.map((r) => ({
    account: r.account,
    date: r.date,
    isTrading: r.isTrading,
    grossCents: r.grossCents,
    profitCents: r.profitCents,
    impressions: r.impressions,
  }));

  return {
    period,
    range,
    lines: ACTIVITY_LINES.map((line) => summariseLineOver(line, days, range, today)),
    coreClients: rankCoreClients(clients, today),
    pulledAt: meta?.pulledAt ? new Date(meta.pulledAt) : null,
    empty: lineRows.length === 0 && clientRows.length === 0 && bidderRows.length === 0,
    today,
  };
}

/** One line's history, for the drill-down. */
export async function lineHistory(line: ActivityLine, days = 90): Promise<LineDay[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(activityDaily)
    .where(and(gte(activityDaily.date, since), sql`${activityDaily.line} = ${line}`))
    .orderBy(desc(activityDaily.date));
  return rows.map((r) => ({
    line,
    date: r.date,
    grossCents: r.grossCents,
    profitCents: r.profitCents,
    impressions: r.impressions,
    entities: r.entities,
  }));
}
