#!/usr/bin/env node
/**
 * Fill company_daily from the checked-in fixture.
 *
 *   DATABASE_URL=… node deploy/revenue-seed.mjs [path-to-fixture]
 *
 * The fixture is a validated snapshot, so this gives a fresh database a correct
 * P&L immediately. revenue-sync.mjs then keeps it current; rows it re-pulls
 * overwrite these. Seeded rows are marked `fixture` so the two are never
 * confused when working out why a number looks the way it does.
 */
import { existsSync, readFileSync } from 'node:fs';
import postgres from 'postgres';

const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required.'); process.exit(1); }

// Beside the job on the server, or in the repo when run from a checkout.
const candidates = [
  process.argv[2],
  new URL('./company-daily.json', import.meta.url).pathname,
  new URL('../fixtures/company-daily.json', import.meta.url).pathname,
].filter(Boolean);
const path = candidates.find((p) => existsSync(p));
if (!path) {
  console.error(`no snapshot found. Looked in:\n  ${candidates.join('\n  ')}`);
  process.exit(1);
}
const snap = JSON.parse(readFileSync(path, 'utf8'));
const sql = postgres(DB, { max: 2, onnotice: () => {} });

const COLS = [
  'pub_gross_cents', 'pub_source_fee_cents', 'pub_net_after_fee_cents', 'pub_payout_cents',
  'pub_profit_cents', 'pub_impressions', 'bidder_gross_cents', 'bidder_profit_cents',
  'bidder_impressions', 'seat_gross_cents', 'seat_payout_cents', 'seat_profit_cents',
  'seat_impressions', 'xe_revenue_cents', 'xe_cost_cents', 'xe_profit_cents', 'xe_impressions',
];

if (snap.columns.length !== COLS.length + 1) {
  console.error(`fixture has ${snap.columns.length} columns, expected ${COLS.length + 1}`);
  process.exit(1);
}

const pulledAt = new Date(snap.pulledAt);
const rows = snap.rows.map((r) => {
  const row = { date: r[0], source: 'fixture', pulled_at: pulledAt };
  COLS.forEach((c, i) => { row[c] = Number(r[i + 1] ?? 0); });
  return row;
});

const [existing] = await sql`select count(*) as n from company_daily`;

await sql`
  insert into company_daily ${sql(rows, 'date', ...COLS, 'source', 'pulled_at')}
  on conflict (date) do update set
    ${sql.unsafe(COLS.map((c) => `${c} = excluded.${c}`).join(', '))},
    source = excluded.source,
    pulled_at = excluded.pulled_at
`;

const [after] = await sql`
  select count(*) as days, min(date)::text as first, max(date)::text as last from company_daily
`;
console.log(
  `seeded ${rows.length} days (table had ${existing.n}). ` +
    `Now ${after.days} days, ${after.first} → ${after.last}.`,
);
await sql.end();
