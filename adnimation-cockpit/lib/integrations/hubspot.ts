import { z } from 'zod';

/**
 * HubSpot — the sales CRM. Read-only.
 *
 * The cockpit copies companies and contacts into its own tables so sales can be
 * worked from one screen and keeps working when HubSpot is slow or down. It
 * never writes back: HubSpot stays the system of record, and a reporting tool
 * that edits the CRM is how two systems start disagreeing.
 *
 * Paging is cursor-based on the CRM v3 API. The portal here holds roughly
 * 63,000 companies and 33,000 contacts, so every call is paged and the sync is
 * incremental — `lastmodifieddate` after the previous run — rather than a full
 * re-read each time.
 */

const API = 'https://api.hubapi.com';

export const COMPANY_PROPERTIES = [
  'name', 'domain', 'lifecyclestage', 'hubspot_owner_id', 'industry', 'country', 'city',
  'phone', 'num_associated_contacts', 'createdate', 'hs_lastmodifieddate',
];

export const CONTACT_PROPERTIES = [
  'firstname', 'lastname', 'email', 'phone', 'jobtitle', 'company', 'lifecyclestage',
  'hubspot_owner_id', 'associatedcompanyid', 'notes_last_updated', 'createdate',
  'lastmodifieddate',
];

const recordSchema = z.object({
  // The REST API returns ids as strings and the connector as numbers. Both are
  // the same id; coerce so one parser handles either source.
  id: z.union([z.string(), z.number()]).transform(String),
  properties: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .default({}),
});

const pageSchema = z.object({
  results: z.array(z.unknown()).default([]),
  paging: z.object({ next: z.object({ after: z.string() }).nullish() }).nullish(),
});

export interface HubSpotCompany {
  hubspotId: string;
  name: string;
  domain: string | null;
  lifecycleStage: string | null;
  ownerId: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  phone: string | null;
  contactCount: number;
  hsCreatedAt: Date | null;
  hsUpdatedAt: Date | null;
}

export interface HubSpotContact {
  hubspotId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  companyName: string | null;
  companyId: string | null;
  lifecycleStage: string | null;
  ownerId: string | null;
  lastActivityAt: Date | null;
  hsCreatedAt: Date | null;
  hsUpdatedAt: Date | null;
}

export interface HubSpotOwner {
  id: string;
  name: string;
  email: string | null;
}

export interface HubSpotPage<T> {
  rows: T[];
  /** Cursor for the next page, or null when the listing is complete. */
  after: string | null;
}

export interface HubSpotAdapter {
  readonly name: 'hubspot';
  listCompanies(after: string | null, limit?: number): Promise<HubSpotPage<HubSpotCompany>>;
  listContacts(after: string | null, limit?: number): Promise<HubSpotPage<HubSpotContact>>;
  listOwners(): Promise<HubSpotOwner[]>;
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
};

const num = (v: unknown): number => {
  const n = Number(str(v) ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const date = (v: unknown): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function normaliseCompany(raw: unknown): HubSpotCompany | null {
  const parsed = recordSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data.properties;
  return {
    hubspotId: parsed.data.id,
    // A company with no name still matters — it is usually a freshly scraped
    // domain — so it is kept and labelled by its domain rather than dropped.
    name: str(p.name) ?? str(p.domain) ?? `Company ${parsed.data.id}`,
    domain: str(p.domain),
    lifecycleStage: str(p.lifecyclestage),
    ownerId: str(p.hubspot_owner_id),
    industry: str(p.industry),
    country: str(p.country),
    city: str(p.city),
    phone: str(p.phone),
    contactCount: num(p.num_associated_contacts),
    hsCreatedAt: date(p.createdate),
    hsUpdatedAt: date(p.hs_lastmodifieddate),
  };
}

export function normaliseContact(raw: unknown): HubSpotContact | null {
  const parsed = recordSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data.properties;
  return {
    hubspotId: parsed.data.id,
    firstName: str(p.firstname),
    lastName: str(p.lastname),
    email: str(p.email),
    phone: str(p.phone),
    jobTitle: str(p.jobtitle),
    companyName: str(p.company),
    companyId: str(p.associatedcompanyid),
    lifecycleStage: str(p.lifecyclestage),
    ownerId: str(p.hubspot_owner_id),
    lastActivityAt: date(p.notes_last_updated),
    hsCreatedAt: date(p.createdate),
    hsUpdatedAt: date(p.lastmodifieddate),
  };
}

/** A contact's display name, falling back through what HubSpot actually has. */
export function contactName(c: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string {
  const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return full || c.email || 'Unnamed contact';
}

class RealHubSpotAdapter implements HubSpotAdapter {
  readonly name = 'hubspot' as const;

  constructor(private readonly token: string) {}

  private headers() {
    return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  private async page<T>(
    path: string,
    properties: string[],
    after: string | null,
    limit: number,
    normalise: (raw: unknown) => T | null,
  ): Promise<HubSpotPage<T>> {
    const url = new URL(`${API}${path}`);
    url.searchParams.set('limit', String(Math.min(100, Math.max(1, limit))));
    url.searchParams.set('properties', properties.join(','));
    if (after) url.searchParams.set('after', after);

    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`hubspot ${path} failed: http_${res.status}`);

    const body = pageSchema.parse(await res.json());
    const rows: T[] = [];
    for (const raw of body.results) {
      const row = normalise(raw);
      if (row) rows.push(row);
    }
    return { rows, after: body.paging?.next?.after ?? null };
  }

  listCompanies(after: string | null, limit = 100) {
    return this.page('/crm/v3/objects/companies', COMPANY_PROPERTIES, after, limit, normaliseCompany);
  }

  listContacts(after: string | null, limit = 100) {
    return this.page('/crm/v3/objects/contacts', CONTACT_PROPERTIES, after, limit, normaliseContact);
  }

  async listOwners(): Promise<HubSpotOwner[]> {
    const out: HubSpotOwner[] = [];
    let after: string | null = null;

    for (let guard = 0; guard < 50; guard += 1) {
      const url = new URL(`${API}/crm/v3/owners`);
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after', after);

      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) throw new Error(`hubspot owners failed: http_${res.status}`);

      const body = z
        .object({
          results: z
            .array(
              z.object({
                id: z.union([z.string(), z.number()]),
                firstName: z.string().nullish(),
                lastName: z.string().nullish(),
                email: z.string().nullish(),
              }),
            )
            .default([]),
          paging: z.object({ next: z.object({ after: z.string() }).nullish() }).nullish(),
        })
        .parse(await res.json());

      for (const o of body.results) {
        out.push({
          id: String(o.id),
          name: [o.firstName, o.lastName].filter(Boolean).join(' ').trim() || (o.email ?? String(o.id)),
          email: o.email ?? null,
        });
      }

      after = body.paging?.next?.after ?? null;
      if (!after) break;
    }

    return out;
  }
}

/** In-memory HubSpot, for tests. Seed it, then page through it. */
export class FakeHubSpotAdapter implements HubSpotAdapter {
  readonly name = 'hubspot' as const;
  private companies: HubSpotCompany[] = [];
  private contacts: HubSpotContact[] = [];
  private owners: HubSpotOwner[] = [];
  failNext = false;

  seed(data: {
    companies?: HubSpotCompany[];
    contacts?: HubSpotContact[];
    owners?: HubSpotOwner[];
  }): void {
    if (data.companies) this.companies = data.companies;
    if (data.contacts) this.contacts = data.contacts;
    if (data.owners) this.owners = data.owners;
  }

  private slice<T>(rows: T[], after: string | null, limit: number): HubSpotPage<T> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('fake_failure');
    }
    const start = after ? Number(after) : 0;
    const page = rows.slice(start, start + limit);
    const next = start + limit < rows.length ? String(start + limit) : null;
    return { rows: page, after: next };
  }

  async listCompanies(after: string | null, limit = 100) {
    return this.slice(this.companies, after, limit);
  }

  async listContacts(after: string | null, limit = 100) {
    return this.slice(this.contacts, after, limit);
  }

  async listOwners() {
    return this.owners;
  }
}

export function createHubSpotAdapter(): HubSpotAdapter {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (process.env.USE_FAKE_INTEGRATIONS === '1' || !token) return new FakeHubSpotAdapter();
  return new RealHubSpotAdapter(token);
}
