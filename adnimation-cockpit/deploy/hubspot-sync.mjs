#!/usr/bin/env node
/**
 * HubSpot → cockpit, as a standalone job on the server.
 *
 *   DATABASE_URL=... HUBSPOT_PERSONAL_ACCESS_KEY=... node hubspot-sync.mjs
 *
 * The app carries this logic in lib/sync/hubspot-mirror.ts, but the deployed
 * artefact is a compiled Next standalone bundle with no importable modules, so
 * the same rules live here as a plain script — exactly as the ClickUp mirror
 * does. The rules, which must stay in step with the TypeScript:
 *
 *  - a row edited or archived in the cockpit is NEVER overwritten. HubSpot is
 *    being wound down; the cockpit is the book, and this is a one-way import;
 *  - a record created here has a `local:` id and cannot collide with a HubSpot
 *    one, so the upsert can never touch it;
 *  - it never writes to HubSpot.
 *
 * A personal access key is not a bearer token — it is an encoded refresh token,
 * the same credential the HubSpot CLI stores. It is exchanged for a short-lived
 * access token, and re-exchanged when that expires, because a full run over
 * sixty thousand companies outlives a single token.
 */
import postgres from 'postgres';

const API = 'https://api.hubapi.com';
const KEY = process.env.HUBSPOT_PERSONAL_ACCESS_KEY;
const STATIC_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const DB = process.env.DATABASE_URL;

if (!DB || (!KEY && !STATIC_TOKEN)) {
  console.error(
    'DATABASE_URL and one of HUBSPOT_PERSONAL_ACCESS_KEY or HUBSPOT_ACCESS_TOKEN are required.',
  );
  process.exit(1);
}

const COMPANY_PROPERTIES = [
  'name', 'domain', 'lifecyclestage', 'hubspot_owner_id', 'industry', 'country', 'city',
  'phone', 'num_associated_contacts', 'createdate', 'hs_lastmodifieddate',
];

const CONTACT_PROPERTIES = [
  'firstname', 'lastname', 'email', 'phone', 'jobtitle', 'company', 'lifecyclestage',
  'hubspot_owner_id', 'associatedcompanyid', 'notes_last_updated', 'createdate',
  'lastmodifieddate',
];

let cached = null;

async function token() {
  if (STATIC_TOKEN && !KEY) return STATIC_TOKEN;
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

  const res = await fetch(`${API}/localdevauth/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encodedOAuthRefreshToken: KEY }),
  });
  if (!res.ok) {
    throw new Error(
      `could not exchange the personal access key: http_${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }

  const body = await res.json();
  if (!body.oauthAccessToken) throw new Error('the exchange returned no access token');

  cached = {
    value: body.oauthAccessToken,
    expiresAt: body.expiresAtMillis ?? Date.now() + (body.expiresIn ?? 1800) * 1000,
    portalId: body.hubId ?? body.portalId ?? null,
    scopes: body.scopeGroups ?? body.scopes ?? [],
  };
  return cached.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, params = {}) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` } });
    if (res.ok) return res.json();

    // 429 is the documented rate limit; 5xx happens under load. Both are worth
    // waiting out — losing a run at company forty thousand is expensive.
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (res.status === 401) {
      cached = null;
      await sleep(1000);
      continue;
    }
    throw new Error(`hubspot ${path} failed: http_${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error(`hubspot ${path} kept failing`);
}

const str = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
};
const num = (v) => {
  const n = Number(str(v) ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const date = (v) => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const sqlDb = postgres(DB, { max: 2, onnotice: () => {} });

async function owners() {
  const byId = new Map();
  let after = null;
  do {
    const page = await api('/crm/v3/owners', { limit: 100, after });
    for (const o of page.results ?? []) {
      const name = [str(o.firstName), str(o.lastName)].filter(Boolean).join(' ').trim();
      byId.set(String(o.id), name || str(o.email) || `Owner ${o.id}`);
    }
    after = page.paging?.next?.after ?? null;
  } while (after);
  return byId;
}

async function syncCompanies(ownerNames) {
  let after = null;
  let n = 0;

  do {
    const page = await api('/crm/v3/objects/companies', {
      limit: 100,
      properties: COMPANY_PROPERTIES.join(','),
      after,
    });

    const rows = (page.results ?? []).map((r) => {
      const p = r.properties ?? {};
      const ownerId = str(p.hubspot_owner_id);
      return {
        hubspot_id: String(r.id),
        name: str(p.name) ?? str(p.domain) ?? `Company ${r.id}`,
        domain: str(p.domain),
        lifecycle_stage: str(p.lifecyclestage),
        owner_id: ownerId,
        owner_name: ownerId ? (ownerNames.get(ownerId) ?? null) : null,
        industry: str(p.industry),
        country: str(p.country),
        city: str(p.city),
        phone: str(p.phone),
        contact_count: num(p.num_associated_contacts),
        hs_created_at: date(p.createdate),
        hs_updated_at: date(p.hs_lastmodifieddate),
        synced_at: new Date(),
        source: 'hubspot',
      };
    });

    if (rows.length > 0) {
      await sqlDb`
        insert into crm_companies ${sqlDb(rows)}
        on conflict (hubspot_id) do update set
          name = excluded.name,
          domain = excluded.domain,
          lifecycle_stage = excluded.lifecycle_stage,
          owner_id = excluded.owner_id,
          owner_name = excluded.owner_name,
          industry = excluded.industry,
          country = excluded.country,
          city = excluded.city,
          phone = excluded.phone,
          contact_count = excluded.contact_count,
          hs_created_at = excluded.hs_created_at,
          hs_updated_at = excluded.hs_updated_at,
          synced_at = excluded.synced_at
        where crm_companies.edited_at is null and crm_companies.archived_at is null
      `;
      n += rows.length;
    }

    after = page.paging?.next?.after ?? null;
    if (n % 2000 === 0 && n > 0) console.log(`  … ${n} companies`);
  } while (after);

  return n;
}

async function syncContacts(ownerNames) {
  let after = null;
  let n = 0;

  do {
    const page = await api('/crm/v3/objects/contacts', {
      limit: 100,
      properties: CONTACT_PROPERTIES.join(','),
      after,
    });

    const rows = (page.results ?? []).map((r) => {
      const p = r.properties ?? {};
      const ownerId = str(p.hubspot_owner_id);
      return {
        hubspot_id: String(r.id),
        first_name: str(p.firstname),
        last_name: str(p.lastname),
        email: str(p.email),
        phone: str(p.phone),
        job_title: str(p.jobtitle),
        company_name: str(p.company),
        company_id: str(p.associatedcompanyid),
        lifecycle_stage: str(p.lifecyclestage),
        owner_id: ownerId,
        owner_name: ownerId ? (ownerNames.get(ownerId) ?? null) : null,
        last_activity_at: date(p.notes_last_updated),
        hs_created_at: date(p.createdate),
        hs_updated_at: date(p.lastmodifieddate),
        synced_at: new Date(),
        source: 'hubspot',
      };
    });

    if (rows.length > 0) {
      await sqlDb`
        insert into crm_contacts ${sqlDb(rows)}
        on conflict (hubspot_id) do update set
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          email = excluded.email,
          phone = excluded.phone,
          job_title = excluded.job_title,
          company_name = excluded.company_name,
          company_id = excluded.company_id,
          lifecycle_stage = excluded.lifecycle_stage,
          owner_id = excluded.owner_id,
          owner_name = excluded.owner_name,
          last_activity_at = excluded.last_activity_at,
          hs_created_at = excluded.hs_created_at,
          hs_updated_at = excluded.hs_updated_at,
          synced_at = excluded.synced_at
        where crm_contacts.edited_at is null and crm_contacts.archived_at is null
      `;
      n += rows.length;
    }

    after = page.paging?.next?.after ?? null;
    if (n % 2000 === 0 && n > 0) console.log(`  … ${n} contacts`);
  } while (after);

  return n;
}

async function main() {
  const started = Date.now();
  await token();
  console.log(`portal ${cached?.portalId ?? 'unknown'}`);

  const ownerNames = await owners();
  console.log(`${ownerNames.size} owners`);

  const companies = await syncCompanies(ownerNames);
  const contacts = await syncContacts(ownerNames);

  const [counts] = await sqlDb`
    select
      (select count(*) from crm_companies where archived_at is null) as companies,
      (select count(*) from crm_contacts  where archived_at is null) as contacts,
      (select count(*) from crm_companies where source = 'local' or edited_at is not null) as owned
  `;

  console.log(
    `read ${companies} companies and ${contacts} contacts in ` +
      `${Math.round((Date.now() - started) / 1000)}s. ` +
      `The book now holds ${counts.companies} companies and ${counts.contacts} contacts, ` +
      `${counts.owned} of them added or edited here.`,
  );

  await sqlDb.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await sqlDb.end().catch(() => {});
  process.exit(1);
});
