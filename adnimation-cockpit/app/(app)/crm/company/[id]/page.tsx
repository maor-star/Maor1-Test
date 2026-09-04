import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getCompany, nameOf } from '@/lib/crm/detail';
import { stageLabel } from '@/lib/crm/queries';
import { STAGE_LABEL } from '@/lib/pipeline/types';
import { STATUS_LABEL } from '@/lib/contracts/status';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { Conversations, CrumbLink, Field } from '@/components/crm/detail-bits';
import { fmtDateTime, fmtMoney } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * One company: who is there, what we have said to any of them, and what the
 * rest of the cockpit already holds about them.
 *
 * The conversations are the company's, not one person's — a thread with three
 * people at Digital Turbine belongs to Digital Turbine, and reading it under
 * only one of their names is how a relationship looks quieter than it is.
 */
export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const detail = await getCompany(decodeURIComponent(id));
  if (!detail) notFound();

  const { company: co, contacts, conversations, conversationCount, deals, contracts } = detail;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="CRM / COMPANY"
        title={co.name}
        action={
          <span className="flex flex-wrap items-center gap-3">
            <CrumbLink href="/crm">← ALL COMPANIES</CrumbLink>
            {co.domain ? (
              <a
                href={`https://${co.domain}`}
                target="_blank"
                rel="noreferrer"
                className="font-semi text-[11.5px] tracking-[0.14em] text-info hover:underline"
              >
                <Num>{co.domain}</Num> ↗
              </a>
            ) : null}
          </span>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_minmax(0,1.15fr)]">
        <div className="space-y-5">
          <HudCard className="gap-0 p-0">
            <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
              <HudCardHeader
                title="The company"
                index="M01"
                action={
                  <span className="flex flex-wrap items-center gap-2">
                    <Tag tone="neutral">{stageLabel(co.lifecycleStage)}</Tag>
                    {co.source === 'local' ? <Tag tone="accent">Added here</Tag> : null}
                  </span>
                }
              />
            </div>
            <div className="grid gap-3 border-t border-line p-[18px] sm:grid-cols-2">
              <Field label="DOMAIN" value={co.domain} href={co.domain ? `https://${co.domain}` : null} ltr />
              <Field label="INDUSTRY" value={co.industry} />
              <Field label="PHONE" value={co.phone} href={co.phone ? `tel:${co.phone}` : null} ltr />
              <Field label="LINKEDIN" value={co.linkedinUrl} href={co.linkedinUrl} ltr />
              <Field label="WEBSITE" value={co.website} href={co.website} ltr />
              <Field label="ADDRESS" value={co.address} />
              <Field label="CITY" value={co.city} />
              <Field label="COUNTRY" value={co.country} />
              <Field label="OWNER" value={co.ownerName} />
              <Field label="LAST SYNCED" value={fmtDateTime(co.syncedAt)} ltr />
            </div>
            {co.notes ? (
              <div className="border-t border-line p-[18px]">
                <p className="hud-label text-[11px]">Notes</p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-neutral-700">{co.notes}</p>
              </div>
            ) : null}
          </HudCard>

          {deals.length > 0 || contracts.length > 0 ? (
            <HudCard className="gap-0 p-0">
              <div className="p-[18px] pb-3">
                <HudCardHeader title="Elsewhere in the cockpit" index="M02" />
              </div>
              {deals.map((d) => (
                <div key={d.id} className="border-t border-line px-[18px] py-2.5">
                  <Link
                    href={`/pipeline?q=${encodeURIComponent(d.name)}`}
                    className="font-cond text-[15px] text-neutral-900 hover:text-accent"
                  >
                    {d.name}
                  </Link>
                  <p className="hud-label mt-0.5 whitespace-normal text-[11px]">
                    DEAL · {STAGE_LABEL[d.stage as keyof typeof STAGE_LABEL] ?? d.stage.toUpperCase()}
                    {d.nextStep ? ` · ${d.nextStep}` : ''}
                    {d.valueCents !== null ? (
                      <>
                        {' · '}
                        <Num>{fmtMoney(d.valueCents)}</Num>
                      </>
                    ) : null}
                  </p>
                </div>
              ))}
              {contracts.map((k) => (
                <div key={k.id} className="border-t border-line px-[18px] py-2.5">
                  <Link href="/contracts" className="font-cond text-[15px] text-neutral-900 hover:text-accent">
                    {k.docType || k.counterparty}
                  </Link>
                  <p className="hud-label mt-0.5 text-[11px]">
                    CONTRACT · {STATUS_LABEL[k.status as keyof typeof STATUS_LABEL] ?? k.status.toUpperCase()}
                  </p>
                </div>
              ))}
            </HudCard>
          ) : null}

          <HudCard className="gap-0 p-0">
            <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
              <HudCardHeader
                title="Who is there"
                index="M03"
                action={
                  <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                    <Num>{contacts.length}</Num>{' '}
                    {contacts.length === 1 ? 'PERSON' : 'PEOPLE'}
                  </span>
                }
              />
            </div>
            {contacts.length === 0 ? (
              <p className="border-t border-line px-[18px] py-3 font-semi text-[12px] text-neutral-500">
                Nobody attached to this company yet.
              </p>
            ) : (
              <ul>
                {contacts.map((p) => (
                  <li key={p.hubspotId} className="border-t border-line px-[18px] py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Link
                        href={`/crm/contact/${encodeURIComponent(p.hubspotId)}`}
                        className="font-cond text-[15px] leading-tight text-neutral-900 hover:text-accent"
                      >
                        {nameOf(p)}
                      </Link>
                      {p.lastActivityAt ? (
                        <span className="shrink-0 font-semi text-[11.5px] tracking-[0.1em] text-neutral-500">
                          Last heard <Num>{fmtDateTime(p.lastActivityAt)}</Num>
                        </span>
                      ) : null}
                    </div>
                    <p className="hud-label mt-0.5 whitespace-normal text-[11px]">
                      {[p.jobTitle, p.email, p.mobile ?? p.phone].filter(Boolean).join(' · ') ||
                        'NO DETAILS YET'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </HudCard>
        </div>

        <HudCard className="gap-0 p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
            <HudCardHeader
              title="Everything you have said to them"
              index="M04"
              action={
                <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                  <Num>{conversationCount}</Num> Across <Num>{contacts.length}</Num>{' '}
                  {contacts.length === 1 ? 'PERSON' : 'PEOPLE'}
                </span>
              }
            />
          </div>
          <Conversations
            conversations={conversations}
            total={conversationCount}
            emptyNote="No mirrored conversation with anyone at this company yet."
          />
        </HudCard>
      </div>
    </div>
  );
}
