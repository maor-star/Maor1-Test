import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getContact, nameOf } from '@/lib/crm/detail';
import { stageLabel } from '@/lib/crm/queries';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { Conversations, CrumbLink, Field } from '@/components/crm/detail-bits';
import { fmtDateTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * One person.
 *
 * The list could show a name and a phone number and nothing else without
 * becoming unreadable, so this is where the rest lives: every field the
 * signature gave, the block it was read from, everyone else at their company,
 * and every conversation they have been on — not the three the list had room
 * for.
 */
export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const detail = await getContact(decodeURIComponent(id));
  if (!detail) notFound();

  const { contact: c, company, colleagues, conversations, conversationCount } = detail;
  const name = nameOf(c);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="CRM / CONTACT"
        title={name}
        action={
          <span className="flex flex-wrap items-center gap-3">
            <CrumbLink href="/crm?view=contacts">← ALL CONTACTS</CrumbLink>
            {company ? (
              <CrumbLink href={`/crm/company/${encodeURIComponent(company.hubspotId)}`}>
                {company.name.toUpperCase()} ↗
              </CrumbLink>
            ) : null}
          </span>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1.1fr_minmax(0,1fr)]">
        <HudCard className="gap-0 p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
            <HudCardHeader
              title="What we know"
              index="K01"
              action={
                <span className="flex flex-wrap items-center gap-2">
                  <Tag tone="neutral">{stageLabel(c.lifecycleStage)}</Tag>
                  {c.source === 'mail' ? (
                    <Tag tone="accent" title="Read out of your mailbox">FROM THE MAIL</Tag>
                  ) : c.source === 'local' ? (
                    <Tag tone="accent">ADDED HERE</Tag>
                  ) : (
                    <Tag tone="outline">HUBSPOT</Tag>
                  )}
                </span>
              }
            />
          </div>

          <div className="grid gap-3 border-t border-divider p-[18px] sm:grid-cols-2">
            <Field label="EMAIL" value={c.email} href={c.email ? `mailto:${c.email}` : null} ltr />
            <Field label="TITLE" value={c.jobTitle} />
            <Field label="PHONE" value={c.phone} href={c.phone ? `tel:${c.phone}` : null} ltr />
            <Field label="MOBILE" value={c.mobile} href={c.mobile ? `tel:${c.mobile}` : null} ltr />
            <Field
              label="COMPANY"
              value={c.companyName}
              href={company ? `/crm/company/${encodeURIComponent(company.hubspotId)}` : null}
            />
            <Field label="LINKEDIN" value={c.linkedinUrl} href={c.linkedinUrl} ltr />
            <Field label="WEBSITE" value={c.website} href={c.website} ltr />
            <Field label="ADDRESS" value={c.address} />
            <Field label="CITY" value={c.city} />
            <Field label="COUNTRY" value={c.country} />
            <Field label="OWNER" value={c.ownerName} />
            <Field
              label="LAST HEARD FROM"
              value={c.lastActivityAt ? fmtDateTime(c.lastActivityAt) : null}
              ltr
            />
          </div>

          {c.notes ? (
            <div className="border-t border-divider p-[18px]">
              <p className="hud-label text-[9px]">NOTES</p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] text-neutral-700">{c.notes}</p>
            </div>
          ) : null}

          {/*
            The block every field above was read out of. A parser is a guess;
            these are the lines the person actually wrote, so anything this
            code does not know how to read yet is still here to read.
          */}
          {c.signature ? (
            <div className="border-t border-divider p-[18px]">
              <p className="hud-label text-[9px]">
                THEIR SIGNATURE
                {c.signatureAt ? (
                  <>
                    {' · '}
                    <Num>{fmtDateTime(c.signatureAt)}</Num>
                  </>
                ) : null}
                {c.sourceThreadId ? (
                  <>
                    {' · '}
                    <a
                      href={`https://mail.google.com/mail/u/0/#all/${c.sourceThreadId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-700 hover:text-accent"
                    >
                      THE MAIL IT CAME FROM ↗
                    </a>
                  </>
                ) : null}
              </p>
              <pre
                dir="ltr"
                className="mt-1 whitespace-pre-wrap border-s-2 border-divider ps-2 text-start text-[12px] leading-relaxed text-neutral-600"
              >
                {c.signature}
              </pre>
            </div>
          ) : null}

          {colleagues.length > 0 ? (
            <div className="border-t border-divider p-[18px]">
              <p className="hud-label text-[9px]">
                ALSO AT {(c.companyName ?? 'THE SAME COMPANY').toUpperCase()} ·{' '}
                <Num>{colleagues.length}</Num>
              </p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {colleagues.map((p) => (
                  <li key={p.hubspotId} className="text-[13px]">
                    <Link
                      href={`/crm/contact/${encodeURIComponent(p.hubspotId)}`}
                      className="text-accent-700 hover:text-accent"
                    >
                      {p.name}
                    </Link>
                    {p.jobTitle ? <span className="text-neutral-500"> · {p.jobTitle}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </HudCard>

        <HudCard className="gap-0 p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
            <HudCardHeader
              title="What you talked about"
              index="K02"
              action={
                <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                  <Num>{conversationCount}</Num>{' '}
                  {conversationCount === 1 ? 'CONVERSATION' : 'CONVERSATIONS'}
                </span>
              }
            />
          </div>
          <Conversations
            conversations={conversations}
            total={conversationCount}
            emptyNote={
              c.email
                ? 'Nothing in the mirrored mail with this address yet.'
                : 'No address on this contact, so there is nothing to match mail against.'
            }
          />
        </HudCard>
      </div>
    </div>
  );
}
