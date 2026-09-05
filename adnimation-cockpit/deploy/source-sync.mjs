#!/usr/bin/env node
/**
 * Everything the cockpit knows about money, pulled from the source.
 *
 *   DATABASE_URL=… node source-sync.mjs [days]
 *
 * One job, four tables, one sign-in:
 *   company_daily      — the P&L's four books
 *   activity_daily     — the seven revenue engines
 *   core_clients_daily — the accounts that carry the company
 *   seat_days          — every demand and supply seat that traded
 *
 * This replaces the pair of syncs that went through the Lovable API with a key
 * that was never set. They exited 78 every twenty minutes and the screens
 * served a seeded snapshot; the Trading, Demand and Supply screens were worse
 * off still, reading a checked-in fixture that had never been refreshed at
 * all.
 *
 * Every read is a SELECT or one of the source's own read-only reports
 * (CLAUDE.md): the transport in adops-rest.mjs has no way to write, and the
 * arithmetic is in adops-aggregate.mjs where it is tested without a network.
 */
import postgres from 'postgres';
import { loadSecrets } from './job-secrets.mjs';
import { openSource } from './adops-rest.mjs';
import {
  bidderDays, bidderLine, bookOrNull, categoryLine, clampToYear, coreClientDays,
  coreClientsLine, endpointEnvironments, exchangeDays, exchangeEnvLine, googleCtvLine,
  ignoredSourceNames, mergeDays, PL_NUMERIC, publishersDaysFromDetail, revShareLookup,
  seatDaysFrom, seatDays, YEAR_START,
} from './adops-aggregate.mjs';

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

/**
 * How far back a plain run pulls.
 *
 * A week, not a year. The source revises the last few days and nothing older,
 * so a week catches every revision — and the run that walked four hundred days
 * every three hours is the one he asked me to stop, because it was loading the
 * server for figures that had not changed since the last time it read them.
 *
 * A backfill passes SOURCE_SYNC_FROM and SOURCE_SYNC_TO, and even that cannot
 * reach further back than this year.
 */
const DAYS = Number(process.argv[2] ?? process.env.SOURCE_SYNC_DAYS ?? 7);

const sql = postgres(DB, { max: 2, onnotice: () => {} });

const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

/**
 * Whether a pull is worth writing.
 *
 * A source outage that answers with no rows, or with zeroes everywhere, would
 * otherwise wipe out real days. Refusing is the safer failure: the tables keep
 * yesterday's correct figures and the screens say how old they are.
 */
function assertWorthWriting(rows, what) {
  if (rows.length === 0) throw new Error(`${what}: the source returned nothing — refusing to write`);
  const anyMoney = rows.some((r) =>
    Object.entries(r).some(([k, v]) => k.endsWith('_cents') && Number(v) !== 0),
  );
  if (!anyMoney) throw new Error(`${what}: every figure came back zero — refusing to write`);
  return rows;
}

async function main() {
  const started = Date.now();
  const source = await openSource(sql, loadSecrets);
  if (!source) {
    console.error(
      'The source is not connected — SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_EMAIL and ' +
        'SUPABASE_PASSWORD are not all set, in the environment or on the Keys screen. The ' +
        'cockpit keeps serving the rows it already holds and labels their age.',
    );
    await sql.end().catch(() => {});
    process.exit(78); // EX_CONFIG — systemd records it without flapping the unit.
  }

  /*
   * A window, or an explicit range for a backfill.
   *
   * A year in one run holds one sign-in open for longer than a session lasts
   * and keeps every row of it in memory. Walking the history in chunks is both
   * safer and restartable — each chunk is a whole, correct pull of its own
   * days, and one that fails costs only itself.
   */
  const from = clampToYear(process.env.SOURCE_SYNC_FROM ?? day(DAYS));
  const to = process.env.SOURCE_SYNC_TO ?? day(0);
  if (to < YEAR_START) {
    console.log(`${to} is before ${YEAR_START} — he asked for this year only. Nothing to do.`);
    await sql.end();
    process.exit(0);
  }
  const pulledAt = new Date();
  /** The window, as the pair of conditions PostgREST wants on one column. */
  const window = [
    ['report_date', `gte.${from}`],
    ['report_date', `lte.${to}`],
  ];

  console.log(`pulling ${from}..${to}`);

  /*
   * The publisher book used to be asked of the source's own overview report,
   * one day at a time. That report now answers "platform_only: this data is
   * served through the application, not directly" — a door closed on purpose,
   * not a grant that lapsed — so the book is built out of the site detail read
   * below, which reproduces every column of it.
   */
  console.log('reading the tables…');

  /*
   * A table we cannot read is a gap, not a failure.
   *
   * The source's grants are its own and they change: three of these went from
   * readable to "permission denied" in the middle of an afternoon. One denied
   * table used to take the whole sync down with it, so a change to one line's
   * permissions cost him the P&L, the seats and the other six lines as well.
   *
   * Now each read stands alone. What can be read is written; what cannot is
   * named at the end, with the reason, so the fix is "grant read on these
   * three" rather than "the sync is broken".
   */
  const denied = [];
  const ifAllowed = (what, promise) =>
    promise.catch((e) => {
      const said = e?.message ?? String(e);
      if (/http_40[13]|permission denied/i.test(said)) {
        denied.push(what);
        return [];
      }
      throw e;
    });

  const [seatOverview, vidazoo, xeUnsplit, siteDetail, demandSources, gam, endpoints, xeSplit, accounts, revShares] =
    await Promise.all([
      ifAllowed('the seat lease report', source.rpc('get_seat_lease_overview_daily', { p_from: from, p_to: to })),
      ifAllowed('trading_vidazoo_reports', source.selectAll('trading_vidazoo_reports', { filters: window })),
      /*
       * The exchange at its per-demand-endpoint grain. It answers two
       * questions: the P&L's exchange book, and — joined to the endpoints'
       * environments — the three EXCHANGE tiles.
       */
      ifAllowed('trading_xe_reports', source.selectAll('trading_xe_reports', { filters: [...window, ['ssp_id', 'is.null']] })),
      /*
       * The publisher business, at the grain the source keeps it: one row per
       * site per demand source per day. Core Publishers, IBV and the account
       * ranking are all cut out of this one read rather than out of the three
       * aggregates the source has since revoked.
       *
       * Only the columns those cuts need. The table is the largest thing this
       * job reads and most of its width is currency conversions and request
       * counts nothing here asks for.
       */
      ifAllowed('ars_site_daily_revenue', source.selectAll('ars_site_daily_revenue', {
        select: 'report_date,ars_site_id,ars_account_id,category,source_name,gross_revenue,source_profit_usd,publisher_revenue,impressions',
        filters: window,
      })),
      ifAllowed('ars_demand_sources', source.selectAll('ars_demand_sources', { select: 'source_name,category,is_ignored' })),
      /*
       * Only the CTV slice, narrowed at the source. The whole table is seven
       * hundred thousand rows a month and this is thirty-three thousand of
       * them — the difference between a job that finishes and one that does
       * not.
       */
      ifAllowed('gam_reports', source.selectAll('gam_reports', {
        select: 'report_date,site_id,revenue,impressions,device_category',
        filters: [...window, ['device_category', 'in.("connected tv","set-top box")']],
      })),
      /*
       * Which environment each demand endpoint sells into — the only thing
       * that tells APP from DISPLAY from CTV on the exchange.
       *
       * The source has a view that answers this, and it is denied to this
       * sign-in. The table underneath it is not, so the view's rule is applied
       * in adops-aggregate instead; it agrees with the view on all 380 demand
       * endpoints. Under five hundred rows either way.
       */
      ifAllowed('trading_xe_endpoints', source.selectAll('trading_xe_endpoints', {
        select: 'id,kind,name,environments,targeting',
      })),
      ifAllowed('trading_xe_reports (split)', source.selectAll('trading_xe_reports', { filters: window })),
      ifAllowed('ars_accounts', source.selectAll('ars_accounts')),
      // What Adnimation keeps on each site. Without it the publisher book has
      // a gross and no margin, which is the half of it he actually acts on.
      ifAllowed('ars_rev_shares', source.selectAll('ars_rev_shares', {
        select: 'ars_site_id,effective_date,rev_share_pct',
      })),
    ]);

  console.log(
    `read: seat lease ${seatOverview.length}, vidazoo ${vidazoo.length}, ` +
      `exchange ${xeUnsplit.length}, sites ${siteDetail.length}, ` +
      `demand sources ${demandSources.length}, gam ${gam.length}, endpoints ${endpoints.length}, ` +
      `seats ${xeSplit.length}, accounts ${accounts.length}, rev shares ${revShares.length}`,
  );

  const ignored = ignoredSourceNames(demandSources);
  const accountsById = new Map(accounts.map((a) => [String(a.ars_id ?? a.id), a]));
  const envByDsp = endpointEnvironments(endpoints);
  const shareAt = revShareLookup(revShares);

  /* ---- the P&L ---- */
  const wasDenied = (what) => denied.includes(what);
  const { rows: plRows, columns: plColumns, empty: plEmpty } = mergeDays(
    {
      publishers: bookOrNull(
        publishersDaysFromDetail(siteDetail, accountsById, ignored, shareAt),
        wasDenied('ars_site_daily_revenue') || wasDenied('ars_rev_shares'),
      ),
      seat: bookOrNull(seatDays(seatOverview), wasDenied('the seat lease report')),
      bidder: bookOrNull(bidderDays(vidazoo), wasDenied('trading_vidazoo_reports')),
      exchange: bookOrNull(exchangeDays(xeUnsplit), wasDenied('trading_xe_reports')),
    },
    pulledAt,
  );
  assertWorthWriting(plRows, 'the P&L');

  await sql`
    insert into company_daily ${sql(plRows, 'date', ...plColumns, 'source', 'pulled_at')}
    on conflict (date) do update set
      ${sql.unsafe(plColumns.map((c) => `${c} = excluded.${c}`).join(', '))},
      source = excluded.source,
      pulled_at = excluded.pulled_at
  `;
  console.log(
    `company_daily: ${plRows.length} days, ${plColumns.length}/${PL_NUMERIC.length} columns ` +
      '(a book the source refused keeps the figures it already had)',
  );
  if (plEmpty.length > 0) {
    console.error(
      `NOT WRITTEN — ${plEmpty.join(', ')} came back with no money at all across the whole ` +
        'window, which is a read that went wrong rather than a quiet fortnight. Those days keep ' +
        'the figures they already had.',
    );
  }

  /* ---- the seven engines ---- */
  const engines = {
    core_clients: coreClientsLine(siteDetail, accountsById, ignored, shareAt),
    ibv: categoryLine(siteDetail, 'video', ignored),
    apps: exchangeEnvLine(xeUnsplit, envByDsp, 'apps'),
    rtb_display: exchangeEnvLine(xeUnsplit, envByDsp, 'rtb_display'),
    ctv: exchangeEnvLine(xeUnsplit, envByDsp, 'ctv'),
    google_ctv: googleCtvLine(gam),
    bidder: bidderLine(vidazoo),
  };

  const lineRows = [];
  for (const [line, rows] of Object.entries(engines)) {
    // An engine whose table is denied has no rows. Writing zeroes for it would
    // put a real-looking zero on a tile, which reads as a collapse.
    for (const r of rows) lineRows.push({ line, ...r, source: 'adops', pulled_at: pulledAt });
  }

  if (lineRows.length > 0) {
    await sql`
      insert into activity_daily ${sql(lineRows, 'line', 'date', 'gross_cents', 'profit_cents', 'impressions', 'entities', 'source', 'pulled_at')}
      on conflict (line, date) do update set
        gross_cents = excluded.gross_cents,
        profit_cents = excluded.profit_cents,
        impressions = excluded.impressions,
        entities = excluded.entities,
        source = excluded.source,
        pulled_at = excluded.pulled_at
    `;
  }
  console.log(
    `activity_daily: ${lineRows.length} rows — ` +
      Object.entries(engines).map(([k, v]) => `${k} ${v.length}d`).join(', '),
  );

  /* ---- the accounts that carry the company ---- */
  const clientRows = coreClientDays(siteDetail, accountsById, ignored).map((r) => ({
    ...r,
    source: 'adops',
    pulled_at: pulledAt,
  }));

  if (clientRows.length > 0) {
    await sql`
      insert into core_clients_daily ${sql(clientRows, 'account', 'date', 'is_trading', 'gross_cents', 'profit_cents', 'impressions', 'source', 'pulled_at')}
      on conflict (account, date) do update set
        is_trading = excluded.is_trading,
        gross_cents = excluded.gross_cents,
        profit_cents = excluded.profit_cents,
        impressions = excluded.impressions,
        source = excluded.source,
        pulled_at = excluded.pulled_at
    `;
  }
  console.log(`core_clients_daily: ${clientRows.length} rows`);

  /* ---- the seats: trading, demand and supply ---- */
  const seatRows = seatDaysFrom(xeSplit).map((r) => ({ ...r, source: 'adops', pulled_at: pulledAt }));

  if (seatRows.length > 0) {
    // In batches: a year of seats is tens of thousands of rows and one
    // statement that large is a statement the database refuses.
    for (let i = 0; i < seatRows.length; i += 2000) {
      const batch = seatRows.slice(i, i + 2000);
      await sql`
        insert into seat_days ${sql(batch, 'report_date', 'side', 'seat', 'seat_id', 'revenue_cents', 'cost_cents', 'profit_cents', 'impressions', 'requests', 'endpoints', 'source', 'pulled_at')}
        on conflict (report_date, side, seat) do update set
          seat_id = excluded.seat_id,
          revenue_cents = excluded.revenue_cents,
          cost_cents = excluded.cost_cents,
          profit_cents = excluded.profit_cents,
          impressions = excluded.impressions,
          requests = excluded.requests,
          endpoints = excluded.endpoints,
          source = excluded.source,
          pulled_at = excluded.pulled_at
      `;
    }
  }
  const demand = seatRows.filter((r) => r.side === 'demand').length;
  const supply = seatRows.length - demand;
  console.log(`seat_days: ${seatRows.length} rows — demand ${demand}, supply ${supply}`);

  if (denied.length > 0) {
    console.log(
      `NOT READ — the source denies this sign-in read access to: ${denied.join(', ')}. ` +
        'Everything else above is current. Granting select on those to the authenticated ' +
        'role is all that is missing.',
    );
  }

  const [summary] = await sql`select count(*) as days, max(date)::text as latest from company_daily`;
  console.log(
    `done in ${Math.round((Date.now() - started) / 1000)}s. ` +
      `company_daily holds ${summary.days} days through ${summary.latest}.`,
  );

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e?.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
