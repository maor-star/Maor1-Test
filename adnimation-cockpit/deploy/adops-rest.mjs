/**
 * Reading the Ad Ops Architect source over its own REST front door.
 *
 * The syncs used to send SQL to the Lovable API, which needs a key that was
 * never set — so every one of them exited 78 and the cockpit served a seeded
 * snapshot for months. This goes straight to the project's Supabase with the
 * publishable key and his sign-in, which is what he actually has.
 *
 * The cost of the change: no arbitrary SQL. PostgREST reads tables and calls
 * named functions, so every aggregation the old queries did in Postgres is now
 * done in Node — in adops-aggregate.mjs, apart from the network, where it can
 * be tested without either.
 *
 * READ ONLY, and enforced rather than intended (CLAUDE.md). There is no way to
 * write from this module: no POST to a table, no PATCH, no DELETE, and the
 * only functions it will call are the two named reporting ones, by allowlist.
 * This is the system the ad ops team works in live.
 */

/**
 * The reporting functions this module may call.
 *
 * An allowlist rather than a rule about naming, because "it starts with get_"
 * is a convention and a convention is not a permission. Both of these return
 * rows and change nothing; anything not on this list is refused here, before
 * it reaches the network.
 */
const READ_ONLY_FUNCTIONS = new Set([
  'get_ars_overview_summary',
  'get_seat_lease_overview_daily',
]);

/** How many rows one page asks for. PostgREST caps its own default far lower. */
const PAGE = 1000;

export class AdOpsSource {
  #url;
  #key;
  #email;
  #password;
  #token = null;

  constructor({ url, anonKey, email, password }) {
    if (!url || !anonKey || !email || !password) {
      throw new Error('the source needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_EMAIL and SUPABASE_PASSWORD');
    }
    this.#url = String(url).replace(/\/+$/, '');
    this.#key = anonKey;
    this.#email = email;
    this.#password = password;
  }

  /** Signs in once and keeps the token for the life of the job. */
  async #auth() {
    if (this.#token) return this.#token;

    const res = await fetch(`${this.#url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: this.#key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.#email, password: this.#password }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.access_token) {
      // The provider's words, never the password.
      throw new Error(`sign-in to the source failed: ${body?.error_description ?? body?.msg ?? `http_${res.status}`}`);
    }
    this.#token = body.access_token;
    return this.#token;
  }

  async #headers(extra = {}) {
    const token = await this.#auth();
    return { apikey: this.#key, Authorization: `Bearer ${token}`, ...extra };
  }

  /** One request, retried only for the failures that are worth retrying. */
  async #send(path, init) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const res = await fetch(`${this.#url}${path}`, init);
      if (res.ok) return res;
      // A rate limit or a server fault may pass; a 400 is a request we built
      // wrong and will build wrong again.
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      const said = await res.text().catch(() => '');
      throw new Error(`source said http_${res.status}: ${said.slice(0, 300)}`);
    }
    throw new Error('the source kept failing');
  }

  /**
   * Every row matching a query, however many pages that takes.
   *
   * PostgREST answers a bounded slice and says how many there are in total, so
   * a year of daily rows arrives whole instead of silently truncated at the
   * first thousand — which would look exactly like a quiet year.
   */
  async selectAll(table, { select = '*', filters = {}, order = null } = {}) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error(`"${table}" is not a table name`);

    const params = new URLSearchParams();
    params.set('select', select);
    for (const [column, condition] of Object.entries(filters)) params.append(column, condition);
    if (order) params.set('order', order);

    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const res = await this.#send(`/rest/v1/${table}?${params.toString()}`, {
        headers: await this.#headers({
          Range: `${from}-${from + PAGE - 1}`,
          'Range-Unit': 'items',
          Prefer: 'count=exact',
        }),
      });
      const page = await res.json();
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }

  /**
   * One of the source's own reporting functions.
   *
   * Allowlisted above. A function name that is not on the list never reaches
   * the network, so this cannot become a way to call anything that writes.
   */
  async rpc(fn, args = {}) {
    if (!READ_ONLY_FUNCTIONS.has(fn)) {
      throw new Error(`refusing to call "${fn}" — it is not one of the source's read-only reports`);
    }
    const res = await this.#send(`/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: await this.#headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(args),
    });
    return res.json();
  }

  /** Signed in and able to read — the two things that fail separately. */
  async health(table = 'ars_site_daily_revenue') {
    await this.#auth();
    const rows = await this.selectAll(table, { select: 'report_date', filters: { limit: 'x' } })
      .catch(() => null);
    return { signedIn: true, canRead: rows !== null };
  }
}

/**
 * The source, from the environment or the app's encrypted store.
 *
 * Jobs already know how to read the store — the same helper the other syncs
 * use for their keys — so he can paste these on the Keys screen and every job
 * picks them up without a deploy.
 */
export async function openSource(sql, loadSecrets) {
  await loadSecrets(sql, [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_EMAIL',
    'SUPABASE_PASSWORD',
  ]);

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const email = process.env.SUPABASE_EMAIL;
  const password = process.env.SUPABASE_PASSWORD;
  if (!url || !anonKey || !email || !password) return null;

  return new AdOpsSource({ url, anonKey, email, password });
}
