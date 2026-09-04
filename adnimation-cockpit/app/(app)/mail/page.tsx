import Link from 'next/link';
import {
  MAIL_VIEWS, MAIL_VIEW_LABEL, listMail, mailCounts, type MailView,
} from '@/lib/mail/service';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Figure } from '@/components/hud/figure';
import { SearchBox } from '@/components/hud/search-box';
import { filterByQuery } from '@/lib/search';
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
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const sp = await searchParams;
  /*
   * The whole inbox by default.
   *
   * It used to open on "important and waiting", which is a good triage list
   * and a bad answer to "where is the mail I am looking at". He compares this
   * screen against Gmail, and anything the filter hides reads as the mirror
   * being broken. Triage is one click away.
   */
  const view: MailView = MAIL_VIEWS.includes(sp.view as MailView)
    ? (sp.view as MailView)
    : 'all';
  const q = sp.q ?? '';

  const [all, counts] = await Promise.all([listMail(view), mailCounts()]);

  // The numbers open the list they count; the search narrows it. Both in the URL.
  const to = (v: MailView) => {
    const params = new URLSearchParams();
    if (v !== 'all') params.set('view', v);
    if (q) params.set('q', q);
    const query = params.toString();
    return query ? `/mail?${query}` : '/mail';
  };
  const rows = filterByQuery(all, q, (t) => [
    t.subject,
    t.snippet,
    t.counterpartName,
    t.counterpartEmail,
    t.knownCompany,
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="MAIL / 07"
        title="Mail"
        action={
          <span className="font-semi text-[11.5px] tracking-[0.14em] text-neutral-500">
            {counts.lastSyncedAt ? (
              <>
                Synced <Num>{fmtDateTime(counts.lastSyncedAt)}</Num>
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
          <Figure
            label="IMPORTANT & WAITING"
            value={fmtNumber(counts.important)}
            big
            tone={counts.important > 0 ? 'warn' : undefined}
            href={to('important')}
            active={view === 'important'}
          />
          <Figure
            label="WAITING IN TOTAL"
            value={fmtNumber(counts.waiting)}
            big
            href={to('waiting')}
            active={view === 'waiting'}
          />
          <Figure
            label="OLDEST UNANSWERED"
            value={counts.oldestWaitingDays === null ? '—' : `${counts.oldestWaitingDays}d`}
            href={to('waiting')}
            active={false}
          />
          <Figure
            label="CARRYING THE INBOX LABEL"
            value={fmtNumber(counts.total)}
            href={to('recent')}
            active={view === 'recent'}
          />
        </div>

        <p className="border-t border-line pt-3 font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
          Waiting means the last message is theirs. Important means somebody in the CRM or the
          team — not Gmail&apos;s guess. Replying happens in Gmail; The cockpit only reads.
        </p>
      </HudCard>

      <p className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
        Every conversation the mirror holds — <Num>{fmtNumber(counts.mirrored)}</Num> Of them,
        newest first. Gmail&apos;s inbox label is one filter among these, not the screen: Mail you
        have read and replied to often carries no inbox label at all.
      </p>

      <nav className="segmented flex-wrap">
        {MAIL_VIEWS.map((v) => (
          <Link
            key={v}
            href={to(v)}
            aria-current={v === view ? 'page' : undefined}
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
              <div className="flex flex-wrap items-center gap-3">
                <SearchBox placeholder="Find a conversation" />
                <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                  <Num>{fmtNumber(rows.length)}</Num>
                  {rows.length === all.length
                    ? rows.length === 1 ? ' THREAD' : ' THREADS'
                    : ` OF ${fmtNumber(all.length)}`}
                </span>
              </div>
            }
          />
        </div>

        {rows.length === 0 ? (
          <p className="border-t border-line px-[18px] py-4 font-semi text-[12px] text-neutral-500">
            {q
              ? `Nothing in this view matches “${q}”.`
              : counts.total === 0
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

