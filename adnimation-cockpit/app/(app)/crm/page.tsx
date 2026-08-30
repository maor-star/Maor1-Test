import Link from 'next/link';
import {
  PAGE_SIZE, STAGE_ORDER, contactsForCompanies, crmFilterOptions, crmSummary, listCompanies,
  listContacts, stageLabel, type CrmFilter,
} from '@/lib/crm/queries';
import { contactName } from '@/lib/integrations/hubspot';
import { companySuggestions } from '@/lib/crm/mutations';
import { ArchiveButton, EditCompany, EditContact } from '@/components/crm/record-forms';
import { AddCrmRecord } from '@/components/crm/add-record';
import { fmtDateTime, fmtNumber } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';

export const dynamic = 'force-dynamic';

const VIEWS = ['companies', 'contacts'] as const;
type View = (typeof VIEWS)[number];

interface SearchParams {
  view?: string;
  q?: string;
  stage?: string;
  owner?: string;
  country?: string;
  industry?: string;
  people?: string;
  source?: string;
  archived?: string;
  page?: string;
}

/** Every filter except the page, so a link can keep them and reset the paging. */
function keep(sp: SearchParams, view: View, patch: Partial<SearchParams> = {}): string {
  const merged: SearchParams = { ...sp, view, page: undefined, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, String(v));
  return `/crm?${qs.toString()}`;
}

/**
 * Sales — the CRM, held in the cockpit's own database.
 *
 * Companies and contacts are copied from HubSpot rather than embedded from it,
 * so the list is searchable here, survives a HubSpot outage, and can be joined
 * against revenue. HubSpot stays the system of record; nothing here writes back
 * to it.
 */
export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const view: View = VIEWS.includes(sp.view as View) ? (sp.view as View) : 'companies';
  const page = Number.parseInt(sp.page ?? '0', 10) || 0;
  const filter: CrmFilter = {
    q: sp.q,
    stage: sp.stage,
    owner: sp.owner,
    country: sp.country,
    industry: sp.industry,
    withContacts: sp.people === '1',
    source: sp.source,
    archived: sp.archived === '1',
    page,
  };

  const [summary, options, companies] = await Promise.all([
    crmSummary(),
    crmFilterOptions(),
    // Only needed by the contacts form, and it is 800 names — do not pay for it
    // while looking at the companies list.
    view === 'contacts' ? companySuggestions() : Promise.resolve<string[]>([]),
  ]);
  const vocab = {
    stages: [...STAGE_ORDER].map((v) => ({ value: v as string, label: stageLabel(v) })),
    owners: options.owners.map((o) => o.value),
  };
  const filtered = Boolean(
    sp.q || sp.stage || sp.owner || sp.country || sp.industry || sp.people || sp.source || sp.archived,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="SALES / 06"
        title="CRM"
        action={
          <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
            THE BOOK LIVES HERE · HUBSPOT IS ONLY WHERE IT CAME FROM
          </span>
        }
      />

      <HudCard>
        <HudCardHeader
          title="The book"
          index="C01"
          action={
            <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
              {summary.lastSyncedAt ? (
                <>
                  SYNCED <Num>{fmtDateTime(summary.lastSyncedAt)}</Num>
                </>
              ) : (
                'NEVER SYNCED'
              )}
            </span>
          }
        />

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <Figure label="COMPANIES" value={fmtNumber(summary.companies)} big />
          <Figure label="CONTACTS" value={fmtNumber(summary.contacts)} big />
          <Figure label="ADDED OR EDITED HERE" value={fmtNumber(summary.ownedHere)} />
          <Figure label="ARCHIVED" value={fmtNumber(summary.archived)} />
        </div>

        {summary.byStage.length > 0 ? (
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-divider pt-3">
            {summary.byStage.map((s) => (
              <Link
                key={s.stage}
                href={keep(sp, 'companies', { stage: s.stage })}
                className="group"
              >
                <span className="hud-label block text-[9px] group-hover:text-accent">{s.label}</span>
                <span className="font-cond text-[20px] leading-none text-neutral-800 group-hover:text-accent">
                  <Num>{fmtNumber(s.companies)}</Num>
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </HudCard>

      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex border border-divider">
          {VIEWS.map((v) => (
            <Link
              key={v}
              href={keep(sp, v)}
              className={`px-3 py-1 font-semi text-[11px] uppercase tracking-[0.16em] ${
                v === view ? 'bg-accent text-ground' : 'text-neutral-500 hover:text-accent'
              }`}
            >
              {v}
            </Link>
          ))}
        </nav>

        <form action="/crm" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="view" value={view} />
          {sp.stage ? <input type="hidden" name="stage" value={sp.stage} /> : null}
          {sp.owner ? <input type="hidden" name="owner" value={sp.owner} /> : null}
          {sp.country ? <input type="hidden" name="country" value={sp.country} /> : null}
          {sp.industry ? <input type="hidden" name="industry" value={sp.industry} /> : null}
          {sp.people ? <input type="hidden" name="people" value={sp.people} /> : null}
          {sp.source ? <input type="hidden" name="source" value={sp.source} /> : null}
          {sp.archived ? <input type="hidden" name="archived" value={sp.archived} /> : null}
          <label className="sr-only" htmlFor="crm-search">
            Search the CRM
          </label>
          <input
            id="crm-search"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder={view === 'companies' ? 'Company or domain' : 'Name, email or company'}
            className="h-8 w-56 border border-divider bg-ground px-2 text-[14px] text-ink placeholder:text-neutral-500"
          />
          <button
            type="submit"
            className="border border-divider px-3 py-1.5 font-semi text-[10px] uppercase tracking-[0.16em] text-neutral-600 hover:border-accent hover:text-accent"
          >
            Search
          </button>
          {filtered ? (
            <Link
              href={`/crm?view=${view}`}
              className="font-semi text-[10px] uppercase tracking-[0.16em] text-accent-700 hover:text-accent"
            >
              Clear
            </Link>
          ) : null}
        </form>

      </div>

      <CrmFilters sp={sp} view={view} options={options} />

      <AddCrmRecord view={view} vocab={vocab} companies={companies} />

      {view === 'companies' ? (
        <Companies filter={filter} sp={sp} vocab={vocab} />
      ) : (
        <Contacts filter={filter} sp={sp} vocab={vocab} companies={companies} />
      )}
    </div>
  );
}

async function Companies({
  filter,
  sp,
  vocab,
}: {
  filter: CrmFilter;
  sp: SearchParams;
  vocab: { stages: { value: string; label: string }[]; owners: string[] };
}) {
  const { rows, total, page } = await listCompanies(filter);
  const contacts = await contactsForCompanies(rows.map((r) => r.hubspotId));

  return (
    <HudCard className="gap-0 p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title="Companies"
          index="C02"
          action={
            <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
              <Num>{fmtNumber(total)}</Num> MATCHING
            </span>
          }
        />
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-divider px-[18px] py-4 font-semi text-[12px] text-neutral-500">
          Nothing matches.
        </p>
      ) : (
        <ul>
          {rows.map((c) => {
            const people = contacts.get(c.hubspotId) ?? [];
            return (
              <li key={c.hubspotId} className="border-t border-divider px-[18px] py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-cond text-[17px] text-neutral-900">{c.name}</p>
                    <p className="hud-label mt-0.5 text-[9px]">
                      {[c.domain, c.city, c.country].filter(Boolean).join(' · ') || 'NO DOMAIN'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {c.source === 'local' ? (
                      <Tag tone="accent" title="Created here, never in HubSpot">
                        ADDED HERE
                      </Tag>
                    ) : c.editedAt ? (
                      <Tag tone="outline" title="Edited here — no sync will overwrite it">
                        EDITED HERE
                      </Tag>
                    ) : null}
                    {c.ownerName ? <Tag tone="outline">{c.ownerName}</Tag> : null}
                    <Tag tone={c.lifecycleStage === 'customer' ? 'ok' : 'neutral'}>
                      {stageLabel(c.lifecycleStage)}
                    </Tag>
                    <ArchiveButton id={c.hubspotId} kind="company" archived={c.archivedAt !== null} />
                  </div>
                </div>

                {people.length > 0 ? (
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
                    {people.map((p) => (
                      <li key={p.hubspotId} className="min-w-0">
                        <span className="truncate font-semi text-[12px] text-neutral-700">
                          {contactName(p)}
                        </span>
                        <p className="truncate font-semi text-[10px] tracking-[0.06em] text-neutral-500">
                          {[p.jobTitle, p.email, p.phone].filter(Boolean).join(' · ') ||
                            'NO CONTACT DETAILS'}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : c.contactCount > 0 ? (
                  <p className="mt-1 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
                    <Num>{c.contactCount}</Num> CONTACT{c.contactCount === 1 ? '' : 'S'} IN HUBSPOT,
                    NOT YET COPIED
                  </p>
                ) : null}

                <div className="mt-2">
                  <EditCompany company={c} vocab={vocab} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pager total={total} page={page} view="companies" sp={sp} />
    </HudCard>
  );
}

async function Contacts({
  filter,
  sp,
  vocab,
  companies,
}: {
  filter: CrmFilter;
  sp: SearchParams;
  vocab: { stages: { value: string; label: string }[]; owners: string[] };
  companies: string[];
}) {
  const { rows, total, page } = await listContacts(filter);

  return (
    <HudCard className="gap-0 p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title="Contacts"
          index="C03"
          action={
            <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
              <Num>{fmtNumber(total)}</Num> MATCHING
            </span>
          }
        />
      </div>

      {/* One row per contact, dense on a wide screen and stacked on a phone.
          A table would scan better but cannot hold an edit form inside a row. */}
      <ul>
        {rows.map((p) => (
          <li key={p.hubspotId} className="border-t border-divider px-[18px] py-3">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-cond text-[16px] leading-none text-neutral-900">
                    {contactName(p)}
                  </p>
                  {p.source === 'local' ? (
                    <Tag tone="accent" title="Created here, never in HubSpot">
                      ADDED HERE
                    </Tag>
                  ) : p.editedAt ? (
                    <Tag tone="outline" title="Edited here — no sync will overwrite it">
                      EDITED HERE
                    </Tag>
                  ) : null}
                  <Tag tone="neutral">{stageLabel(p.lifecycleStage)}</Tag>
                </div>
                <p className="hud-label mt-1 whitespace-normal text-[9px]">
                  {[p.companyName, p.jobTitle].filter(Boolean).join(' · ') || 'NO COMPANY'}
                </p>
                <p className="mt-1 break-words text-[12px] text-neutral-600">
                  {p.email ? <Num>{p.email}</Num> : null}
                  {p.email && p.phone ? ' · ' : null}
                  {p.phone ? <Num>{p.phone}</Num> : null}
                  {!p.email && !p.phone ? 'No contact details' : null}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {p.ownerName ? <Tag tone="outline">{p.ownerName}</Tag> : null}
                <ArchiveButton id={p.hubspotId} kind="contact" archived={p.archivedAt !== null} />
              </div>
            </div>

            <div className="mt-2">
              <EditContact contact={p} vocab={vocab} companies={companies} />
            </div>
          </li>
        ))}
      </ul>

      {rows.length === 0 ? (
        <p className="border-t border-divider px-[18px] py-4 font-semi text-[12px] text-neutral-500">
          Nothing matches.
        </p>
      ) : null}

      <Pager total={total} page={page} view="contacts" sp={sp} />
    </HudCard>
  );
}

function Pager({
  total,
  page,
  view,
  sp,
}: {
  total: number;
  page: number;
  view: View;
  sp: SearchParams;
}) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;

  const href = (p: number) => `${keep(sp, view)}&page=${p}`;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-divider px-[18px] py-2 font-semi text-[10px] tracking-[0.14em] text-neutral-500">
      <span>
        PAGE <Num>{page + 1}</Num> OF <Num>{fmtNumber(pages)}</Num>
      </span>
      <span className="flex gap-4">
        {page > 0 ? (
          <Link href={href(page - 1)} className="text-accent-700 hover:text-accent">
            PREVIOUS
          </Link>
        ) : null}
        {page + 1 < pages ? (
          <Link href={href(page + 1)} className="text-accent-700 hover:text-accent">
            NEXT
          </Link>
        ) : null}
      </span>
    </div>
  );
}

function Figure({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="hud-label text-[9px]">{label}</p>
      <p
        className={
          big
            ? 'hud-numeral mt-1 text-[30px] sm:text-[36px]'
            : 'mt-1 font-cond text-[20px] font-medium leading-none text-neutral-800'
        }
      >
        <Num>{value}</Num>
      </p>
    </div>
  );
}

/**
 * The filter bar. Everything here narrows the same book, and every control
 * keeps the others — narrowing a list is done in passes, not in one shot.
 */
function CrmFilters({
  sp,
  view,
  options,
}: {
  sp: SearchParams;
  view: View;
  options: {
    owners: { value: string; n: number }[];
    countries: { value: string; n: number }[];
    industries: { value: string; n: number }[];
  };
}) {
  const stages = [...STAGE_ORDER];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-divider p-2">
      <FilterChips
        label="TYPE"
        options={stages.map((s) => ({ value: s, label: stageLabel(s) }))}
        active={sp.stage}
        hrefFor={(v) => keep(sp, view, { stage: v })}
      />

      {options.owners.length > 0 ? (
        <FilterChips
          label="OWNER"
          options={options.owners.slice(0, 8).map((o) => ({ value: o.value, label: o.value }))}
          active={sp.owner}
          hrefFor={(v) => keep(sp, view, { owner: v })}
        />
      ) : null}

      {view === 'companies' && options.countries.length > 0 ? (
        <FilterChips
          label="COUNTRY"
          options={options.countries.slice(0, 8).map((o) => ({ value: o.value, label: o.value }))}
          active={sp.country}
          hrefFor={(v) => keep(sp, view, { country: v })}
        />
      ) : null}

      {view === 'companies' && options.industries.length > 0 ? (
        <FilterChips
          label="INDUSTRY"
          options={options.industries.slice(0, 8).map((o) => ({ value: o.value, label: o.value }))}
          active={sp.industry}
          hrefFor={(v) => keep(sp, view, { industry: v })}
        />
      ) : null}

      <FilterChips
        label="ORIGIN"
        options={[
          { value: 'local', label: 'ADDED HERE' },
          { value: 'hubspot', label: 'FROM HUBSPOT' },
        ]}
        active={sp.source}
        hrefFor={(v) => keep(sp, view, { source: v })}
      />

      {view === 'companies' ? (
        <Link
          href={keep(sp, view, { people: sp.people === '1' ? undefined : '1' })}
          className={`px-2 py-1 font-semi text-[10px] uppercase tracking-[0.14em] ${
            sp.people === '1'
              ? 'bg-accent text-ground'
              : 'border border-divider text-neutral-500 hover:text-accent'
          }`}
        >
          Has a contact
        </Link>
      ) : null}

      <Link
        href={keep(sp, view, { archived: sp.archived === '1' ? undefined : '1' })}
        className={`px-2 py-1 font-semi text-[10px] uppercase tracking-[0.14em] ${
          sp.archived === '1'
            ? 'bg-accent text-ground'
            : 'border border-divider text-neutral-500 hover:text-accent'
        }`}
      >
        Archived
      </Link>
    </div>
  );
}

function FilterChips({
  label,
  options,
  active,
  hrefFor,
}: {
  label: string;
  options: { value: string; label: string }[];
  active?: string;
  hrefFor: (value: string | undefined) => string;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <span className="hud-label me-1 text-[9px]">{label}</span>
      {options.map((o) => (
        <Link
          key={o.value}
          href={hrefFor(active === o.value ? undefined : o.value)}
          className={`px-2 py-0.5 font-semi text-[10px] uppercase tracking-[0.1em] ${
            active === o.value
              ? 'bg-accent text-ground'
              : 'border border-divider text-neutral-500 hover:text-accent'
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
