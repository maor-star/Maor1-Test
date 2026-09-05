import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import { appSecrets, db } from '@/lib/db';
import { decrypt, encrypt, secret } from '@/lib/secrets/store';

/**
 * The Ad Ops Architect source, read directly.
 *
 * Until now the cockpit reached this data through the Lovable API, which needs
 * a key that is not set — so every line tile said "nothing from the source
 * yet" and the figures came from a seeded snapshot. This is the same data over
 * its own front door: the project's Supabase, signed in as him, holding the
 * session open so it does not have to log in again on every job.
 *
 * READ ONLY, and enforced here rather than intended here. The repository's
 * standing rule is that this system is the one the ad ops team actually works
 * in and the cockpit only ever SELECTs from it, so this module exposes no way
 * to write: no insert, no update, no delete, no RPC — those verbs are not on
 * the surface at all, and the client is never handed out to a caller who could
 * reach for them.
 *
 * Nothing here is hardcoded to a table either. Any table the source lets him
 * read can be read by name, so one the ad ops team adds next month works the
 * day it exists, with no deploy and no list to update. What is NOT possible is
 * enumerating the tables: the source only hands its schema to a `service_role`
 * key, which is the key that bypasses every permission — we deliberately do
 * not hold one, and `listTables` says so rather than quietly returning none.
 */

const SESSION_KEY = 'ADOPS_SUPABASE_SESSION';

export interface AdOpsConfig {
  url: string;
  anonKey: string;
  email: string;
  password: string;
}

/**
 * What the connection needs, from the environment or the Keys screen.
 *
 * `secret()` reads the environment first and the app's own encrypted store
 * second, so the deploy can set these and he can also paste them himself
 * without either quietly overriding the other.
 */
export async function adopsConfig(): Promise<AdOpsConfig | null> {
  const [url, anonKey, email, password] = await Promise.all([
    secret('SUPABASE_URL'),
    secret('SUPABASE_ANON_KEY'),
    secret('SUPABASE_EMAIL'),
    secret('SUPABASE_PASSWORD'),
  ]);
  if (!url || !anonKey || !email || !password) return null;
  return { url, anonKey, email, password };
}

/** Which pieces are missing, for a screen that has to say why it cannot look. */
export async function missingConfig(): Promise<string[]> {
  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_EMAIL', 'SUPABASE_PASSWORD'];
  const found = await Promise.all(names.map((n) => secret(n)));
  return names.filter((_, i) => !found[i]);
}

/**
 * Where the signed-in session is kept.
 *
 * supabase-js expects browser storage. On a server there is none, and without
 * somewhere to put it every job, every page render and every restart would log
 * in again — which is what "a permanent connection" is meant to stop.
 *
 * So the session lives in the app's own encrypted store, in one reserved row.
 * It is written straight rather than through `setSecret` on purpose: a token
 * that refreshes itself every hour would otherwise write an audit row every
 * hour, and drown the audit log that exists to show real decisions.
 */
const sessionStore = {
  async getItem(): Promise<string | null> {
    const [row] = await db
      .select()
      .from(appSecrets)
      .where(eq(appSecrets.key, SESSION_KEY))
      .limit(1);
    return row ? decrypt(row.valueEnc) : null;
  },
  async setItem(_key: string, value: string): Promise<void> {
    const valueEnc = encrypt(value);
    await db
      .insert(appSecrets)
      .values({ key: SESSION_KEY, valueEnc, hint: 'session', updatedBy: 'adops' })
      .onConflictDoUpdate({ target: appSecrets.key, set: { valueEnc, updatedAt: new Date() } });
  },
  async removeItem(): Promise<void> {
    await db.delete(appSecrets).where(eq(appSecrets.key, SESSION_KEY));
  },
};

let client: SupabaseClient | null = null;
let signedInFor: string | null = null;

/**
 * The signed-in client, made once and kept.
 *
 * The session refreshes itself and survives a restart, so a sign-in happens
 * the first time and then only when the stored session has genuinely expired.
 * Kept private to this module — handing it to a caller would hand them the
 * write verbs with it.
 */
async function connect(): Promise<
  { ok: true; client: SupabaseClient } | { ok: false; error: string }
> {
  const config = await adopsConfig();
  if (!config) {
    const missing = await missingConfig();
    return {
      ok: false,
      error: `The source is not connected yet — ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } not set. Paste them on the Keys screen.`,
    };
  }

  const identity = `${config.url}:${config.email}`;
  if (client && signedInFor === identity) {
    const { data } = await client.auth.getSession();
    if (data.session) return { ok: true, client };
  }

  client = createClient(config.url, config.anonKey, {
    auth: {
      // The three things that make the connection permanent: keep the session,
      // refresh it before it dies, and put it somewhere that outlives the
      // process.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: sessionStore,
      storageKey: SESSION_KEY,
    },
  });
  signedInFor = identity;

  const { data } = await client.auth.getSession();
  if (data.session) return { ok: true, client };

  const { error } = await client.auth.signInWithPassword({
    email: config.email,
    password: config.password,
  });
  if (error) {
    client = null;
    signedInFor = null;
    // The message is the provider's, never the password.
    return { ok: false, error: `Could not sign in to the source: ${error.message}` };
  }

  return { ok: true, client };
}

export interface AdOpsHealth {
  ok: boolean;
  /** Plainly what is wrong, when something is. */
  error: string | null;
  /** The account the connection is signed in as. */
  signedInAs: string | null;
  /** The table the check read from, and whether it gave anything back. */
  probed: string | null;
  rows: number | null;
}

/**
 * The table the health check reads one row from.
 *
 * Signing in proves the credentials; reading proves the permissions, and those
 * fail separately — a session that authenticates but can see nothing is the
 * failure that looks like success.
 */
const PROBE_TABLE = 'ars_site_daily_revenue';

/**
 * Is the connection alive, right now.
 *
 * A live check rather than a remembered one: "connected" that means "connected
 * an hour ago" is the answer that wastes an afternoon.
 */
export async function adopsHealth(probe = PROBE_TABLE): Promise<AdOpsHealth> {
  const connected = await connect();
  if (!connected.ok) {
    return { ok: false, error: connected.error, signedInAs: null, probed: null, rows: null };
  }

  const { data } = await connected.client.auth.getUser();
  const signedInAs = data.user?.email ?? null;

  const read = await selectRows(probe, { columns: 'report_date', limit: 1 });
  if (!read.ok) {
    return { ok: false, error: read.error, signedInAs, probed: probe, rows: null };
  }

  return { ok: true, error: null, signedInAs, probed: probe, rows: read.rows.length };
}

export type TablesResult =
  | { ok: true; tables: string[] }
  | { ok: false; error: string };

/**
 * Every table the source exposes — when it will say.
 *
 * It will not, with the key we hold. PostgREST publishes its schema at the
 * root, and this source answers that endpoint only for a `service_role` key:
 * the one that bypasses row-level security entirely. Holding a key like that
 * to populate a dropdown is a bad trade against a system the ad ops team works
 * in live, so this returns the reason instead.
 *
 * Reading is unaffected — `selectRows` takes any table name and a new table
 * works the day it is created. Only listing them is closed.
 */
export async function listTables(): Promise<TablesResult> {
  const config = await adopsConfig();
  if (!config) return { ok: false, error: 'The source is not connected yet.' };

  const connected = await connect();
  if (!connected.ok) return { ok: false, error: connected.error };

  const { data } = await connected.client.auth.getSession();
  const token = data.session?.access_token ?? config.anonKey;

  let res: Response;
  try {
    res = await fetch(`${config.url.replace(/\/+$/, '')}/rest/v1/`, {
      headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not reach the source' };
  }
  if (!res.ok) {
    const said = (await res.json().catch(() => null)) as { hint?: string; message?: string } | null;
    return {
      ok: false,
      error: said?.hint ?? said?.message ?? `The source answered http_${res.status}`,
    };
  }

  /*
   * Swagger 2.0 puts them in `definitions`, OpenAPI 3 in `components.schemas`.
   * Both are read, so a PostgREST upgrade does not quietly empty the list.
   */
  const body = (await res.json().catch(() => null)) as
    | {
        definitions?: Record<string, unknown>;
        components?: { schemas?: Record<string, unknown> };
        message?: string;
        hint?: string;
      }
    | null;

  const names = Object.keys(body?.definitions ?? body?.components?.schemas ?? {}).sort();
  if (names.length === 0) {
    return {
      ok: false,
      error:
        body?.hint ??
        body?.message ??
        'The source will not list its tables for this key. Reading a table by name still works.',
    };
  }
  return { ok: true, tables: names };
}

/** How a column is narrowed. Every one of these only ever filters a read. */
export type Comparison = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'in';

export interface Filter {
  column: string;
  op: Comparison;
  value: string | number | boolean | (string | number)[];
}

export interface SelectOptions {
  /** The columns to bring back. Everything, when not said. */
  columns?: string;
  filters?: Filter[];
  orderBy?: { column: string; ascending?: boolean };
  /** Bounded on purpose: a screen that pulls a million rows is a screen that hangs. */
  limit?: number;
}

export type SelectResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; error: string };

/** The most rows one call will ever return. */
const MAX_ROWS = 5000;

/**
 * Read from the source.
 *
 * The only thing this module can do. There is no insert, update, delete or RPC
 * here to reach for, which is how the read-only rule is kept by the code
 * rather than by whoever is editing it next.
 */
export async function selectRows<T = Record<string, unknown>>(
  table: string,
  options: SelectOptions = {},
): Promise<SelectResult<T>> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    return { ok: false, error: `"${table}" is not a table name` };
  }

  const connected = await connect();
  if (!connected.ok) return { ok: false, error: connected.error };

  let query = connected.client.from(table).select(options.columns ?? '*');

  for (const f of options.filters ?? []) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.column)) {
      return { ok: false, error: `"${f.column}" is not a column name` };
    }
    /*
     * Dispatched by hand rather than as `query[f.op](...)`.
     *
     * The client types each comparison separately, so an indexed call collapses
     * to a union with no shared signature and stops compiling. Written out, it
     * also reads as what it is: a closed list of ways to narrow a read, with no
     * way to smuggle a verb in through `op`.
     */
    const value = f.value;
    switch (f.op) {
      case 'in':
        query = query.in(f.column, Array.isArray(value) ? value : [value as string | number]);
        break;
      case 'eq': query = query.eq(f.column, value); break;
      case 'neq': query = query.neq(f.column, value); break;
      case 'gt': query = query.gt(f.column, value); break;
      case 'gte': query = query.gte(f.column, value); break;
      case 'lt': query = query.lt(f.column, value); break;
      case 'lte': query = query.lte(f.column, value); break;
      case 'like': query = query.like(f.column, String(value)); break;
      case 'ilike': query = query.ilike(f.column, String(value)); break;
    }
  }

  if (options.orderBy) {
    query = query.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? true });
  }

  query = query.limit(Math.min(Math.max(1, options.limit ?? 1000), MAX_ROWS));

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as T[] };
}

/** Sign out and forget the stored session — for when he changes the password. */
export async function forgetSession(): Promise<void> {
  await sessionStore.removeItem();
  client = null;
  signedInFor = null;
}
