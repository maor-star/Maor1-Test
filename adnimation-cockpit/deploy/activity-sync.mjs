#!/usr/bin/env node
/**
 * Pull the control panel's lines from the Ad Ops Architect source.
 *
 *   DATABASE_URL=… LOVABLE_API_KEY=… LOVABLE_PROJECT_ID=… node activity-sync.mjs
 *
 * Seven business lines per day and every paying account per day, over a
 * trailing window that is re-pulled each run because the source keeps revising
 * a day for hours after it ends. Read-only against the source; the local
 * tables are upserted by primary key so a re-run corrects rather than doubles.
 *
 * Exit 78 (EX_CONFIG) when the credential is not set: a known state, not a
 * fault, and the screen keeps serving the rows it already holds with their age.
 */
import postgres from 'postgres';
import { loadSecrets } from './job-secrets.mjs';
import {
  LINES, assertWorthWriting, coreClientsQuery, lineQueries, toClientRows, toLineRows,
} from './activity-source.mjs';
import { assertSelect } from './revenue-source.mjs';

const DB = process.env.DATABASE_URL;
const WINDOW_DAYS = Number(process.env.ACTIVITY_SYNC_DAYS ?? 4);
const CLIENT_DAYS = Number(process.env.ACTIVITY_CLIENT_DAYS ?? 3);

if (!DB) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const sql = postgres(DB, { max: 2, onnotice: () => {} });

/*
 * He can paste the Lovable key into the Keys screen instead of waiting for a
 * deploy, so the store is read before the credential check — otherwise a key
 * the screen says is set would never reach the job that needs it.
 */
const filled = await loadSecrets(sql, ['LOVABLE_API_KEY', 'LOVABLE_PROJECT_ID']);
if (filled.length > 0) console.log(`using ${filled.join(' and ')} from the Keys screen`);

const KEY = process.env.LOVABLE_API_KEY;
const PROJECT = process.env.LOVABLE_PROJECT_ID;
if (!KEY || !PROJECT) {
  console.error(
    'LOVABLE_API_KEY and LOVABLE_PROJECT_ID are not set, in the environment or on the Keys ' +
      'screen, so there is nothing to pull from. The control panel keeps serving the last ' +
      'synced rows and labels their age.',
  );
  await sql.end().catch(() => {});
  process.exit(78);
}

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
  const pulledAt = new Date();
  const q = lineQueries(from, to);

  // One line failing must not take the others down with it: a broken feed
  // table is a broken feed, not a broken panel.
  const lineRows = [];
  const failures = [];
  for (const line of LINES) {
    try {
      const rows = await query(q[line]);
      lineRows.push(...toLineRows(line, rows, pulledAt));
      console.log(`${line}: ${rows.length} days`);
    } catch (e) {
      failures.push(`${line}: ${e.message ?? e}`);
    }
  }
  assertWorthWriting(lineRows);

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

  // The accounts, one call per day — the function only speaks in ranges.
  let clientRows = [];
  for (let i = CLIENT_DAYS; i >= 1; i -= 1) {
    const d = day(i);
    try {
      clientRows.push(...toClientRows(await query(coreClientsQuery(d)), pulledAt));
    } catch (e) {
      failures.push(`core clients ${d}: ${e.message ?? e}`);
    }
  }
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

  console.log(
    `wrote ${lineRows.length} line-days and ${clientRows.length} account-days in ` +
      `${Math.round((Date.now() - started) / 1000)}s.`,
  );
  for (const f of failures) console.error(`failed — ${f}`);

  await sql.end();
  process.exit(failures.length > 0 && lineRows.length === 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
});
