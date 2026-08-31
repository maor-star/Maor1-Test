#!/usr/bin/env node
/**
 * The company P&L, pulled from the Ad Ops Architect source into our own table.
 *
 *   DATABASE_URL=… LOVABLE_API_KEY=… LOVABLE_PROJECT_ID=… node revenue-sync.mjs
 *
 * Why this exists: the P&L used to be a JSON file compiled into the build, so
 * the only way to change a number on screen was to redeploy the whole app. The
 * figures were not wrong, they were frozen at the moment of the last deploy.
 *
 * READ-ONLY against the source, and enforced rather than merely intended — see
 * assertSelect in revenue-source.mjs. The Ad Ops Architect system is the live
 * system the ad ops team works in and nothing here may write to it.
 *
 * It re-pulls a trailing window rather than just today, because the source
 * keeps receiving reports for a day long after that day ends. A one-day pull
 * would permanently record whatever partial figure existed at 03:00 — which is
 * exactly how the previous snapshot came to understate 2026-08-29 ninefold.
 */
import postgres from 'postgres';
import { NUMERIC, assertSelect, assertWorthWriting, buildQueries, mergeDays } from './revenue-source.mjs';

const DB = process.env.DATABASE_URL;
const KEY = process.env.LOVABLE_API_KEY;
const PROJECT = process.env.LOVABLE_PROJECT_ID;
const WINDOW_DAYS = Number(process.env.REVENUE_SYNC_DAYS ?? 10);

if (!DB) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
if (!KEY || !PROJECT) {
  // Not a failure worth alerting on: the credential has simply not been
  // supplied yet, and the cockpit keeps serving the rows it already holds.
  console.error(
    'LOVABLE_API_KEY and LOVABLE_PROJECT_ID are not set, so there is nothing to pull from. ' +
      'The cockpit will keep serving the last synced rows and will label their age.',
  );
  process.exit(78); // EX_CONFIG — systemd records it without flapping the unit.
}

const sql = postgres(DB, { max: 2, onnotice: () => {} });

async function query(statement) {
  assertSelect(statement);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(
      `https://api.lovable.dev/v1/projects/${encodeURIComponent(PROJECT)}/database/query`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: statement }),
      },
    );
    if (res.ok) return (await res.json()).rows ?? [];
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`source query failed: http_${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error('source query kept failing');
}

const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const started = Date.now();
  const from = day(WINDOW_DAYS);
  const to = day(0);
  const q = buildQueries(from, to);

  const [pub, seat, bid, xe] = await Promise.all([
    query(q.publishers), query(q.seats), query(q.bidder), query(q.exchange),
  ]);
  console.log(
    `pulled ${from}..${to}: publishers ${pub.length}, seat ${seat.length}, ` +
      `bidder ${bid.length}, exchange ${xe.length} days`,
  );

  const rows = assertWorthWriting(mergeDays([pub, seat, bid, xe]));

  await sql`
    insert into company_daily ${sql(rows, 'date', ...NUMERIC, 'source', 'pulled_at')}
    on conflict (date) do update set
      ${sql.unsafe(NUMERIC.map((c) => `${c} = excluded.${c}`).join(', '))},
      source = excluded.source,
      pulled_at = excluded.pulled_at
  `;

  const [summary] = await sql`
    select count(*) as days, max(date)::text as latest from company_daily
  `;
  const [latest] = await sql`
    select date::text as date,
      (pub_profit_cents + bidder_profit_cents + seat_profit_cents + xe_profit_cents) as profit
    from company_daily where date = (select max(date) - 1 from company_daily)
  `;

  console.log(
    `wrote ${rows.length} days in ${Math.round((Date.now() - started) / 1000)}s. ` +
      `Table holds ${summary.days} days through ${summary.latest}. ` +
      `Company profit on ${latest?.date}: $${(Number(latest?.profit ?? 0) / 100).toFixed(2)}.`,
  );

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
