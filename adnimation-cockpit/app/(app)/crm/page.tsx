import Link from 'next/link';
import {
  PAGE_SIZE, contactsForCompanies, crmSummary, listCompanies, listContacts, stageLabel,
} from '@/lib/crm/queries';
import { contactName } from '@/lib/integrations/hubspot';
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
  page?: string;
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
  const filter = { q: sp.q, stage: sp.stage, page };

  const summary = await crmSummary();

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="SALES / 06"
        title="CRM"
        action={
          <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
            SOURCE: HUBSPOT · COPIED INTO THE COCKPIT
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
          <Figure label="CONTACTS WITH EMAIL" value={fmtNumber(summary.contactsWithEmail)} />
          <Figure
            label="OWNERS"
            value={fmtNumber(summary.owners.length)}
          />
        </div>

        {summary.byStage.length > 0 ? (
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-divider pt-3">
            {summary.byStage.map((s) => (
              <Link
                key={s.stage}
                href={`/crm?view=companies&stage=${encodeURIComponent(s.stage)}`}
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
              href={`/crm?view=${v}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`}
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
          {sp.q || sp.stage ? (
            <Link
              href={`/crm?view=${view}`}
              className="font-semi text-[10px] uppercase tracking-[0.16em] text-accent-700 hover:text-accent"
            >
              Clear
            </Link>
          ) : null}
        </form>

        {sp.stage ? <Tag tone="accent">{stageLabel(sp.stage)}</Tag> : null}
      </div>

      {view === 'companies' ? (
        <Companies filter={filter} />
      ) : (
        <Contacts filter={filter} />
      )}
    </div>
  );
}

async function Companies({
  filter,
}: {
  filter: { q?: string; stage?: string; page: number };
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
                    {c.ownerName ? <Tag tone="outline">{c.ownerName}</Tag> : null}
                    <Tag tone={c.lifecycleStage === 'customer' ? 'ok' : 'neutral'}>
                      {stageLabel(c.lifecycleStage)}
                    </Tag>
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
              </li>
            );
          })}
        </ul>
      )}

      <Pager total={total} page={page} view="companies" q={filter.q} stage={filter.stage} />
    </HudCard>
  );
}

async function Contacts({
  filter,
}: {
  filter: { q?: string; stage?: string; page: number };
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

      {/* Phone: a card per contact. Desktop: the table. */}
      <ul className="lg:hidden">
        {rows.map((p) => (
          <li key={`m:${p.hubspotId}`} className="border-t border-divider px-[18px] py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-cond text-[16px] text-neutral-900">{contactName(p)}</p>
                <p className="hud-label mt-0.5 text-[9px]">{p.companyName ?? 'NO COMPANY'}</p>
              </div>
              <Tag tone="neutral">{stageLabel(p.lifecycleStage)}</Tag>
            </div>
            <p className="mt-1 truncate font-semi text-[11px] text-neutral-600">
              {[p.jobTitle, p.email, p.phone].filter(Boolean).join(' · ') || 'NO CONTACT DETAILS'}
            </p>
          </li>
        ))}
      </ul>

      <div className="hidden min-w-0 overflow-x-auto lg:block">
        <table className="cockpit-table">
          <thead>
            <tr>
              <th className="w-[22%]">Contact</th>
              <th>Company</th>
              <th>Title</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Owner</th>
              <th className="text-end">Stage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.hubspotId}>
                <td className="whitespace-normal font-cond text-[15px] text-neutral-900">
                  {contactName(p)}
                </td>
                <td className="text-neutral-600">{p.companyName ?? '—'}</td>
                <td className="text-neutral-500">{p.jobTitle ?? '—'}</td>
                <td className="text-neutral-500">
                  {p.email ? <Num>{p.email}</Num> : '—'}
                </td>
                <td className="text-neutral-500">{p.phone ? <Num>{p.phone}</Num> : '—'}</td>
                <td className="text-neutral-500">{p.ownerName ?? '—'}</td>
                <td className="text-end">
                  <Tag tone="neutral">{stageLabel(p.lifecycleStage)}</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-divider px-[18px] py-4 font-semi text-[12px] text-neutral-500">
          Nothing matches.
        </p>
      ) : null}

      <Pager total={total} page={page} view="contacts" q={filter.q} stage={filter.stage} />
    </HudCard>
  );
}

function Pager({
  total,
  page,
  view,
  q,
  stage,
}: {
  total: number;
  page: number;
  view: View;
  q?: string;
  stage?: string;
}) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;

  const href = (p: number) =>
    `/crm?view=${view}&page=${p}${q ? `&q=${encodeURIComponent(q)}` : ''}${
      stage ? `&stage=${encodeURIComponent(stage)}` : ''
    }`;

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
