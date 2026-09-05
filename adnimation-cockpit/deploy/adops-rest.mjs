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

/**
 * A breather between pages, in milliseconds.
 *
 * Zero for the routine run — a week of rows is a handful of pages and pausing
 * between them would only make the job longer for no one's benefit.
 *
 * A backfill is the other case. Reading a year means hundreds of pages back to
 * back against the system the ad ops team is working in at that moment, and he
 * asked for it "in small groups, with gaps, without loading the server". So a
 * backfill sets this and the paging idles between requests instead of taking
 * everything it can as fast as it can.
 */
const pagePause = () => Number(process.env.ADOPS_PAGE_PAUSE_MS ?? 0);

export class AdOpsSource {
  #url;
  #key;
  #email;
  #password;
  #token = null;
  /** The sign-in in flight, so ten parallel reads share one. */
  #signingIn = null;

  constructor({ url, anonKey, email, password }) {
    if (!url || !anonKey || !email || !password) {
      throw new Error('the source needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_EMAIL and SUPABASE_PASSWORD');
    }
    this.#url = String(url).replace(/\/+$/, '');
    this.#key = anonKey;
    this.#email = email;
    this.#password = password;
  }

  /**
   * Signs in once and keeps the token for the life of the job.
   *
   * Single-flight on purpose. The reads run ten at a time, and without this
   * all ten find no token, all ten POST to the token endpoint at once, and the
   * provider throttles the burst — after which some of them carry on with no
   * token at all and the source answers "permission denied for table", which
   * reads like a permissions problem and is really a stampede.
   */
  async #auth() {
    if (this.#token) return this.#token;
    if (this.#signingIn) return this.#signingIn;

    this.#signingIn = this.#signIn().finally(() => {
      this.#signingIn = null;
    });
    return this.#signingIn;
  }

  async #signIn() {
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

  /**
   * One request, retried only for the failures that are worth retrying.
   *
   * `build` makes the request fresh on every attempt, because a retry after a
   * sign-in has to carry the NEW token — headers captured once would replay
   * the expired one for ever.
   */
  async #send(build) {
    let signedInAgain = false;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { path, init } = await build();
      /*
       * Every request is bounded. A fetch with no timeout against a report
       * that never returns hangs the whole job with nothing in the log, and
       * systemd kills it half an hour later having written nothing.
       */
      const res = await fetch(`${this.#url}${path}`, {
        ...init,
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) return res;

      /*
       * The session expired mid-run.
       *
       * A Supabase access token lasts an hour, and a backfill of four hundred
       * days takes longer than that. When it lapses the request falls back to
       * the anonymous role and the source answers "permission denied" — which
       * reads like a permissions problem and is really a clock. So sign in
       * again, once, and carry on where it stopped.
       */
      if ((res.status === 401 || res.status === 403) && !signedInAgain) {
        signedInAgain = true;
        this.#token = null;
        await this.#auth();
        continue;
      }

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
   * PostgREST answers a bounded slice — a thousand rows, capped server-side —
   * so a year of daily rows arrives whole instead of silently truncated at the
   * first page, which would look exactly like a quiet year.
   *
   * Which is why every caller filters at the SOURCE rather than afterwards. Ad
   * Manager reports seven hundred thousand rows for a month; the CTV slice of
   * it is thirty-three thousand. Pulling the first and narrowing here would be
   * seven hundred requests instead of thirty-three — the difference between a
   * job that finishes and one that gives up.
   */
  async selectAll(table, { select = '*', filters = [], order = null } = {}) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error(`"${table}" is not a table name`);

    const params = new URLSearchParams();
    params.set('select', select);
    /*
     * Filters are PAIRS, not an object, because a column takes more than one
     * condition: a date range is `report_date=gte.X` AND `report_date=lte.Y`.
     * Written as an object the second key overwrote the first, the lower bound
     * vanished, and the job read every row the source had ever recorded — a
     * three-day pull came back with forty-six thousand rows and never
     * finished. It looked exactly like a slow network.
     */
    for (const [column, condition] of filters) params.append(column, condition);
    if (order) params.set('order', order);

    const rows = [];
    const started = Date.now();
    for (let from = 0; ; from += PAGE) {
      /*
       * A hard stop on the paging.
       *
       * Without it a source that stops advancing — a Range header ignored, a
       * proxy that always answers the first page — is an infinite loop that
       * looks exactly like a slow job, which is how the first run of this sync
       * sat for twenty-eight minutes and wrote nothing.
       */
      if (from > 500_000) {
        throw new Error(`${table}: more than half a million rows — narrow the filter`);
      }
      const res = await this.#send(async () => ({
        path: `/rest/v1/${table}?${params.toString()}`,
        // No `count=exact`: it counts the whole matching set on every page,
        // which on a table of hundreds of thousands of rows costs more than
        // the page does. The page's own length says whether there is more.
        init: {
          headers: await this.#headers({
            Range: `${from}-${from + PAGE - 1}`,
            'Range-Unit': 'items',
          }),
        },
      }));
      const page = await res.json();
      rows.push(...page);

      // Between pages, never after the last one: the pause is there to space
      // out requests, and there is no request after this to space out from.
      const pause = pagePause();
      if (page.length === PAGE && pause > 0) {
        await new Promise((r) => setTimeout(r, pause));
      }

      if (page.length < PAGE) {
        if (process.env.ADOPS_VERBOSE) {
          console.error(`  read ${table}: ${rows.length} rows in ${Math.round((Date.now() - started) / 1000)}s`);
        }
        return rows;
      }
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
    const res = await this.#send(async () => ({
      path: `/rest/v1/rpc/${fn}`,
      init: {
        method: 'POST',
        headers: await this.#headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(args),
      },
    }));
    return res.json();
  }

  /**
   * Signed in and able to read — the two things that fail separately.
   *
   * A session that authenticates but can see nothing is the failure that looks
   * like success, so this does both and says which one broke.
   */
  async health(table = 'ars_site_daily_revenue') {
    await this.#auth();
    try {
      const res = await this.#send(async () => ({
        path: `/rest/v1/${table}?select=report_date`,
        init: { headers: await this.#headers({ Range: '0-0', 'Range-Unit': 'items' }) },
      }));
      const rows = await res.json();
      return { signedIn: true, canRead: true, rows: rows.length, error: null };
    } catch (e) {
      return { signedIn: true, canRead: false, rows: null, error: e?.message ?? String(e) };
    }
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
