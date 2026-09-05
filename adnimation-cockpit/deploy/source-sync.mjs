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
  appsLine, bidderDays, bidderLine, coreClientDays, coreClientsLine, ctvLine, eachDay,
  exchangeDays, googleCtvLine, publishersDay, rollupLine, seatDaysFrom, seatDays,
} from './adops-aggregate.mjs';

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

/** How far back to pull. A year by default: he asked for all of it. */
const DAYS = Number(process.argv[2] ?? process.env.SOURCE_SYNC_DAYS ?? 400);

const sql = postgres(DB, { max: 2, onnotice: () => {} });

const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

/** The P&L's money columns, in the order the table holds them. */
const PL_NUMERIC = [
  'pub_gross_cents', 'pub_source_fee_cents', 'pub_net_after_fee_cents', 'pub_payout_cents',
  'pub_profit_cents', 'pub_impressions',
  'bidder_gross_cents', 'bidder_profit_cents', 'bidder_impressions',
  'seat_gross_cents', 'seat_payout_cents', 'seat_profit_cents', 'seat_impressions',
  'xe_revenue_cents', 'xe_cost_cents', 'xe_profit_cents', 'xe_impressions',
];

/**
 * One row per day, with a real zero wherever a line reported nothing.
 *
 * A line that reported nothing on a day earned nothing on that day. Leaving it
 * undefined would drop the whole day out of a SUM further up.
 */
function mergeDays(sets, pulledAt) {
  const byDate = new Map();
  for (const set of sets) {
    for (const row of set ?? []) {
      if (!row?.date) continue;
      const target = byDate.get(row.date) ?? { date: row.date };
      for (const [k, v] of Object.entries(row)) {
        if (k !== 'date' && PL_NUMERIC.includes(k)) target[k] = Number(v ?? 0);
      }
      byDate.set(row.date, target);
    }
  }
  return [...byDate.values()]
    .map((r) => {
      const full = { date: r.date, source: 'adops', pulled_at: pulledAt };
      for (const k of PL_NUMERIC) full[k] = Number.isFinite(r[k]) ? r[k] : 0;
      return full;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

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

  const from = day(DAYS);
  const to = day(0);
  const pulledAt = new Date();
  const between = { report_date: `gte.${from}` };
  const andTo = { report_date: `lte.${to}` };

  console.log(`pulling ${from}..${to}`);

  /*
   * The publisher report is per site for a range, so it is asked one day at a
   * time — the same shape the old query's lateral join per day had. Batched a
   * fortnight at a time so a year is not four hundred requests in flight.
   */
  const days = eachDay(from, to);
  const publisherRows = [];
  for (let i = 0; i < days.length; i += 14) {
    const batch = days.slice(i, i + 14);
    const results = await Promise.all(
      batch.map((d) =>
        source
          .rpc('get_ars_overview_summary', { p_from: d, p_to: d })
          .then((rows) => publishersDay(d, rows))
          .catch(() => null),
      ),
    );
    publisherRows.push(...results.filter(Boolean));
  }

  const [seatOverview, vidazoo, xeUnsplit, rollup, coreSnapshot, gam, gamApps, xeEcon, xeSplit, accounts] =
    await Promise.all([
      source.rpc('get_seat_lease_overview_daily', { p_from: from, p_to: to }),
      source.selectAll('trading_vidazoo_reports', { filters: { ...between, ...andTo } }),
      source.selectAll('trading_xe_reports', { filters: { ...between, ...andTo, ssp_id: 'is.null' } }),
      source.selectAll('ars_site_daily_rollup', { filters: { ...between, ...andTo } }),
      source.selectAll('ars_core_publishers_daily_snapshot', { filters: { ...between, ...andTo } }),
      /*
       * Only the CTV slice, narrowed at the source. The whole table is seven
       * hundred thousand rows a month and this is thirty-three thousand of
       * them — the difference between a job that finishes and one that does
       * not.
       */
      source.selectAll('gam_reports', {
        select: 'report_date,site_id,revenue,impressions,device_category',
        filters: { ...between, ...andTo, device_category: 'in.("connected tv","set-top box")' },
      }),
      source.selectAll('gam_app_reports', {
        select: 'report_date,site_id,app_id,revenue,impressions',
        filters: { ...between, ...andTo },
      }),
      // Likewise: CTV is under a thousand rows a month out of half a million.
      source.selectAll('xe_econ_path_daily', {
        select: 'report_date,dsp_id,env_type,revenue,profit,impressions',
        filters: { ...between, ...andTo, env_type: 'eq.CTV' },
      }),
      source.selectAll('trading_xe_reports', { filters: { ...between, ...andTo } }),
      source.selectAll('ars_accounts'),
    ]);

  console.log(
    `read: publishers ${publisherRows.length}d, seat lease ${seatOverview.length}, ` +
      `vidazoo ${vidazoo.length}, exchange ${xeUnsplit.length}, rollup ${rollup.length}, ` +
      `core ${coreSnapshot.length}, gam ${gam.length}, apps ${gamApps.length}, ` +
      `paths ${xeEcon.length}, seats ${xeSplit.length}, accounts ${accounts.length}`,
  );

  /* ---- the P&L ---- */
  const plRows = assertWorthWriting(
    mergeDays(
      [publisherRows, seatDays(seatOverview), bidderDays(vidazoo), exchangeDays(xeUnsplit)],
      pulledAt,
    ),
    'the P&L',
  );

  await sql`
    insert into company_daily ${sql(plRows, 'date', ...PL_NUMERIC, 'source', 'pulled_at')}
    on conflict (date) do update set
      ${sql.unsafe(PL_NUMERIC.map((c) => `${c} = excluded.${c}`).join(', '))},
      source = excluded.source,
      pulled_at = excluded.pulled_at
  `;
  console.log(`company_daily: ${plRows.length} days`);

  /* ---- the seven engines ---- */
  const engines = {
    core_clients: coreClientsLine(coreSnapshot),
    ibv: rollupLine(rollup, 'video'),
    rtb_display: rollupLine(rollup, 'header_bidding'),
    apps: appsLine(gamApps),
    ctv: ctvLine(xeEcon),
    google_ctv: googleCtvLine(gam),
    bidder: bidderLine(vidazoo),
  };

  const lineRows = [];
  for (const [line, rows] of Object.entries(engines)) {
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
  const accountsById = new Map(accounts.map((a) => [String(a.id ?? a.ars_id), a]));
  const clientRows = coreClientDays(rollup, accountsById, new Map()).map((r) => ({
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
