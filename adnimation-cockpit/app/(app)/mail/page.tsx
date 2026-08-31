import Link from 'next/link';
import {
  MAIL_VIEWS, MAIL_VIEW_LABEL, listMail, mailCounts, type MailView,
} from '@/lib/mail/service';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Num } from '@/components/num';
import { ThreadRow } from '@/components/mail/thread-row';
import { fmtDateTime, fmtNumber } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Mail — but not a mail client.
 *
 * He is in Gmail all day; a second copy of his inbox would be worth nothing.
 * What the cockpit knows and Gmail does not is which conversations are waiting
 * on *him*, and which of those are with people the company actually deals
 * with — matched against the CRM rather than guessed.
 *
 * Replying happens in Gmail. The scope granted is readonly, deliberately: this
 * reads the mailbox, it does not run it.
 */
export default async function MailPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const view: MailView = MAIL_VIEWS.includes(sp.view as MailView)
    ? (sp.view as MailView)
    : 'important';

  const [rows, counts] = await Promise.all([listMail(view), mailCounts()]);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="MAIL / 07"
        title="Mail"
        action={
          <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
            {counts.lastSyncedAt ? (
              <>
                SYNCED <Num>{fmtDateTime(counts.lastSyncedAt)}</Num>
              </>
            ) : (
              'NEVER SYNCED'
            )}
          </span>
        }
      />

      <HudCard>
        <HudCardHeader title="What is waiting on you" index="M01" />

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <Figure label="IMPORTANT & WAITING" value={fmtNumber(counts.important)} big tone={counts.important > 0 ? 'warn' : undefined} />
          <Figure label="WAITING IN TOTAL" value={fmtNumber(counts.waiting)} big />
          <Figure
            label="OLDEST UNANSWERED"
            value={counts.oldestWaitingDays === null ? '—' : `${counts.oldestWaitingDays}d`}
          />
          <Figure label="IN THE INBOX" value={fmtNumber(counts.total)} />
        </div>

        <p className="border-t border-divider pt-3 font-semi text-[10px] tracking-[0.12em] text-neutral-500">
          WAITING MEANS THE LAST MESSAGE IS THEIRS. IMPORTANT MEANS SOMEBODY IN THE CRM OR THE
          TEAM — NOT GMAIL&apos;S GUESS. REPLYING HAPPENS IN GMAIL; THE COCKPIT ONLY READS.
        </p>
      </HudCard>

      <p className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
        THIS IS YOUR INBOX. <Num>{fmtNumber(counts.mirrored - counts.total)}</Num> MORE
        CONVERSATIONS WERE ROUTED PAST IT BY YOUR OWN GMAIL RULES — THEY ARE UNDER “FILTERED PAST
        THE INBOX” AND ARE STILL READ FOR OPPORTUNITIES.
      </p>

      <nav className="flex flex-wrap border border-divider">
        {MAIL_VIEWS.map((v) => (
          <Link
            key={v}
            href={`/mail?view=${v}`}
            className={`px-3 py-1 font-semi text-[11px] uppercase tracking-[0.16em] ${
              v === view ? 'bg-accent text-ground' : 'text-neutral-500 hover:text-accent'
            }`}
          >
            {MAIL_VIEW_LABEL[v]}
          </Link>
        ))}
      </nav>

      <HudCard className="gap-0 p-0">
        <div className="p-[18px] pb-3">
          <HudCardHeader
            title={MAIL_VIEW_LABEL[view]}
            index="M02"
            action={
              <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                <Num>{fmtNumber(rows.length)}</Num> {rows.length === 1 ? 'THREAD' : 'THREADS'}
              </span>
            }
          />
        </div>

        {rows.length === 0 ? (
          <p className="border-t border-divider px-[18px] py-4 font-semi text-[12px] text-neutral-500">
            {counts.total === 0
              ? 'The mailbox has not been read yet. The sync runs every fifteen minutes.'
              : view === 'important'
                ? 'Nothing important is waiting on you.'
                : 'Nothing in this view.'}
          </p>
        ) : (
          <ul>
            {rows.map((t) => (
              <ThreadRow key={t.threadId} thread={t} />
            ))}
          </ul>
        )}
      </HudCard>
    </div>
  );
}

function Figure({
  label,
  value,
  big = false,
  tone,
}: {
  label: string;
  value: string;
  big?: boolean;
  tone?: 'warn';
}) {
  return (
    <div>
      <span className="hud-label block text-[9px]">{label}</span>
      <span
        className={`font-cond leading-none ${big ? 'text-[30px]' : 'text-[22px]'} ${
          tone === 'warn' ? 'text-sev-warning' : 'text-neutral-900'
        }`}
      >
        <Num>{value}</Num>
      </span>
    </div>
  );
}
