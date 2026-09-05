#!/usr/bin/env node
/**
 * Is the Ad Ops Architect source reachable, and does it answer.
 *
 *   DATABASE_URL=… node adops-check.mjs [table] [rows]
 *
 * Signs in the way the app does, reports what it is signed in as, counts the
 * tables the source exposes, and pulls a few rows from one of them so the
 * answer is "it works" rather than "it authenticated".
 *
 * SELECT only, like everything that touches this system (CLAUDE.md). It reads
 * its four settings from the app's own encrypted store, so there is nothing to
 * pass on the command line and no secret in a shell history.
 */
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createDecipheriv, createHash } from 'node:crypto';

const DB = process.env.DATABASE_URL;
const AUTH = process.env.AUTH_SECRET;
if (!DB || !AUTH) {
  console.error('DATABASE_URL and AUTH_SECRET are both required.');
  process.exit(1);
}

const TABLE = process.argv[2] ?? 'ars_site_daily_revenue';
const ROWS = Number(process.argv[3] ?? 5);

/** The same AES-256-GCM the app writes with — see lib/secrets/store.ts. */
function decrypt(stored) {
  try {
    const [ivB64, tagB64, bodyB64] = String(stored).split(':');
    if (!ivB64 || !tagB64 || !bodyB64) return null;
    const key = createHash('sha256').update(`cockpit-secrets:${AUTH}`).digest();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(bodyB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

const sql = postgres(DB, { max: 1 });

const NAMES = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_EMAIL', 'SUPABASE_PASSWORD'];
const rows = await sql`select key, value_enc from app_secrets where key = any(${NAMES})`;
const stored = Object.fromEntries(rows.map((r) => [r.key, decrypt(r.value_enc)]));

// The environment wins, exactly as the app resolves it.
const config = Object.fromEntries(NAMES.map((n) => [n, process.env[n] || stored[n] || null]));
const missing = NAMES.filter((n) => !config[n]);

if (missing.length > 0) {
  console.error(`not connected — missing: ${missing.join(', ')}`);
  await sql.end();
  process.exit(1);
}

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { error: signInError } = await supabase.auth.signInWithPassword({
  email: config.SUPABASE_EMAIL,
  password: config.SUPABASE_PASSWORD,
});
if (signInError) {
  console.error(`sign-in failed: ${signInError.message}`);
  await sql.end();
  process.exit(1);
}

const { data: me } = await supabase.auth.getUser();
console.log(`signed in as ${me.user?.email ?? 'unknown'}`);

const { data: session } = await supabase.auth.getSession();
const schema = await fetch(`${config.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/`, {
  headers: {
    apikey: config.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.session?.access_token ?? config.SUPABASE_ANON_KEY}`,
  },
});
const body = schema.ok ? await schema.json().catch(() => null) : null;
const tables = Object.keys(body?.definitions ?? {}).sort();
console.log(`tables exposed: ${tables.length}`);
if (process.argv.includes('--tables')) console.log(tables.join('\n'));

const { data, error } = await supabase.from(TABLE).select('*').limit(ROWS);
if (error) {
  console.error(`select from ${TABLE} failed: ${error.message}`);
  await sql.end();
  process.exit(1);
}

console.log(`${TABLE}: ${data.length} row(s)`);
console.log(JSON.stringify(data, null, 2));

await sql.end();
