import { Suspense } from 'react';
import Link from 'next/link';
import { summariseCompany } from '@/lib/revenue/company';
import { topSeats } from '@/lib/seats/service';
import { urgentWork, clientsToCall } from '@/lib/overview/service';
import { listDelegations } from '@/lib/delegation/module';
import { mailNeedingReply, mailCounts } from '@/lib/mail/service';
import { inboxOpportunities } from '@/lib/opportunities/module';
import { listPipeline } from '@/lib/pipeline/service';
import { STAGE_LABEL } from '@/lib/pipeline/types';
import { PERIOD_LABEL } from '@/lib/revenue/periods';
import { fmtDateTime, fmtMoney } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { DeltaPct } from '@/components/revenue/delta';
import { Sparkline } from '@/components/revenue/sparkline';
import { InlineTaskEditor } from '@/components/tasks/inline-task-editor';
import { listDepartments, listPeople } from '@/lib/tasks/queries';
import { loadControlPanel } from '@/lib/control/service';
import { ControlPanel } from '@/components/home/control-panel';
import { CompanyTotal } from '@/components/home/company-total';

export const dynamic = 'force-dynamic';

/**
 * The overview — the whole company on one screen.
 *
 * The questions a CEO asks, in order: what did we make yesterday, what is
 * waiting on somebody, what is waiting on me, which seats are carrying us,
 * what is urgent, and who needs a call.
 *
 * The two "waiting" panels come first because they are the only things here
 * that decay: a delegation nobody answered and a mail nobody replied to both
 * get worse by sitting. Everything below is a real figure from a real source;
 * a panel with no data says so rather than showing a zero that reads like a
 * collapse.
 */
export default function OverviewPage() {
  return (
    <div className="space-y-5">
      <PageHeader kicker="OVERVIEW / 01" title="The company" />

      {/*
        The control panel first: every line of the business, live from the
        source, before anything the cockpit itself keeps. It is the screen he
        asked to be able to run the company from.
      */}
      <Suspense fallback={<Skeleton title="Control panel" index="C01" />}>
        <ControlPanelSection />
      </Suspense>

      <Suspense fallback={<Skeleton title="Profit" index="O01" />}>
        <ProfitStrip />
      </Suspense>

      <div className="grid gap-5 xl:grid-cols-2">
        <Suspense fallback={<Skeleton title="Waiting on the team" index="O02" />}>
          <WaitingOnTeamCard />
        </Suspense>
        <Suspense fallback={<Skeleton title="Waiting on you" index="O03" />}>
          <WaitingOnYouCard />
        </Suspense>
      </div>

      <Suspense fallback={<Skeleton title="Slipping away" index="O04" />}>
        <SlippingAwayCard />
      </Suspense>

      <div className="grid gap-5 xl:grid-cols-2">
        <Suspense fallback={<Skeleton title="Strongest supply" index="O02" />}>
          <TopSeatsCard side="supply" />
        </Suspense>
        <Suspense fallback={<Skeleton title="Strongest demand" index="O03" />}>
          <TopSeatsCard side="demand" />
        </Suspense>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Suspense fallback={<Skeleton title="Urgent" index="O04" />}>
          <UrgentCard />
        </Suspense>
        <Suspense fallback={<Skeleton title="Clients to call" index="O05" />}>
          <ClientsCard />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * The company first, then its lines.
 *
 * The lines are seven different cuts of the business and they overlap on
 * purpose, so the total above them is the P&L rather than their sum.
 */
const HOME_PERIODS = ['YESTERDAY', '7D', 'MTD', 'QTD'] as const;

async function ControlPanelSection() {
  const [panel, ...summaries] = await Promise.all([
    loadControlPanel(),
    ...HOME_PERIODS.map((p) => summariseCompany(p)),
  ]);
  const periods = HOME_PERIODS.map((period, i) => ({ period, summary: summaries[i]! }));

  return (
    <>
      <CompanyTotal periods={periods} headline={summaries[0]!} />
      <ControlPanel panel={panel} />
    </>
  );
}

/** What the company made, yesterday and month to date, by line. */
async function ProfitStrip() {
  const [day, mtd] = await Promise.all([summariseCompany('YESTERDAY'), summariseCompany('MTD')]);

  return (
    <HudCard>
      <HudCardHeader
        title="Profit"
        index="O01"
        action={
          <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
            LAST FULL DAY <Num>{day.lastCompleteDay}</Num> ·{' '}
            <Link href="/revenue" className="text-accent-700 hover:text-accent">
              FULL BREAKDOWN
            </Link>
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 xl:flex xl:flex-wrap xl:items-end xl:gap-x-10">
        <Figure label="PROFIT / DAY" value={fmtMoney(day.company.profitCents)} big />
        <Figure label="GROSS / DAY" value={fmtMoney(day.company.grossCents)} />
        <Figure
          label="MARGIN"
          value={day.company.marginPct === null ? '—' : `${(day.company.marginPct * 100).toFixed(1)}%`}
        />
        <Figure label={`PROFIT ${PERIOD_LABEL.MTD}`} value={fmtMoney(mtd.company.profitCents)} />
        <div>
          <p className="hud-label text-[9px]">VS SAME DAY LAST WEEK</p>
          <p className="mt-1">
            <DeltaPct delta={{ pct: day.deltaPct, absCents: null }} />
          </p>
        </div>
      </div>

      <Sparkline
        values={mtd.series.map((d) => d.profitCents)}
        className="mt-1 h-12 w-full text-accent-500"
      />

      <div className="grid gap-x-6 gap-y-2 border-t border-divider pt-3 sm:grid-cols-2 xl:grid-cols-4">
        {day.lines.map((l) => (
          <div key={l.line} className="min-w-0">
            <p className="hud-label truncate text-[9px]">{l.label}</p>
            <p className="font-cond text-[20px] leading-none text-neutral-900">
              <Num>{fmtMoney(l.profitCents)}</Num>
            </p>
            <p className="mt-0.5 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
              <Num>{(l.shareOfProfit * 100).toFixed(0)}%</Num> OF PROFIT ·{' '}
              <Num>{l.marginPct === null ? '—' : `${(l.marginPct * 100).toFixed(0)}%`}</Num> MARGIN
            </p>
          </div>
        ))}
      </div>
    </HudCard>
  );
}

/** The five seats carrying each side of the exchange. */
async function TopSeatsCard({ side }: { side: 'demand' | 'supply' }) {
  const top = await topSeats('30D', 5);
  const seats = side === 'demand' ? top.demand : top.supply;

  return (
    <HudCard className="gap-0 p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title={side === 'demand' ? 'Strongest demand' : 'Strongest supply'}
          index={side === 'demand' ? 'O03' : 'O02'}
          action={
            <Link
              href={`/seats/${side}`}
              className="font-semi text-[10px] tracking-[0.14em] text-accent-700 hover:text-accent"
            >
              ALL SEATS
            </Link>
          }
        />
      </div>

      {seats.length === 0 ? (
        <p className="border-t border-divider px-[18px] py-3 font-semi text-[12px] text-neutral-500">
          No seat data in the last 30 days.
        </p>
      ) : (
        <ol>
          {seats.map((s, i) => (
            <li key={s.seat} className="border-t border-divider px-[18px] py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 font-cond text-[19px] leading-none text-accent-700">
                    <Num>{String(i + 1).padStart(2, '0')}</Num>
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-cond text-[16px] text-neutral-900">{s.seat}</p>
                    <p className="hud-label mt-0.5 text-[9px]">
                      {s.company} · <Num>{s.activeDays}</Num>/30 DAYS LIVE
                    </p>
                  </div>
                </div>
                <div className="text-end">
                  <p className="font-cond text-[18px] leading-none text-neutral-900">
                    <Num>{fmtMoney(s.revPerDayCents)}</Num>
                    <span className="ms-1 text-[10px] text-neutral-500">/DAY</span>
                  </p>
                  <p className="mt-0.5 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
                    PROFIT <Num>{fmtMoney(s.profitPerDayCents)}</Num> ·{' '}
                    <Num>{(s.targetRatio * 100).toFixed(0)}%</Num> OF TARGET
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="border-t border-divider px-[18px] py-2 font-semi text-[10px] tracking-[0.12em] text-neutral-500">
        30 DAYS TO <Num>{top.meta.lastCompleteDay}</Num> · BY REVENUE
      </div>
    </HudCard>
  );
}

/** What needs doing now — overdue and burning work, from the ClickUp mirror. */
async function UrgentCard() {
  const [{ rows, overdue, burning, total }, departments, people] = await Promise.all([
    urgentWork(8),
    listDepartments(),
    listPeople(),
  ]);
  const deptOptions = departments.map((d) => ({ id: d.id, label: d.nameHe }));
  const peopleOptions = people.map((p) => ({ id: p.id, label: p.name }));

  return (
    <HudCard className="gap-0 p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title="Urgent"
          index="O04"
          action={
            <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
              <Num>{overdue}</Num> OVERDUE · <Num>{burning}</Num> P0/P1 ·{' '}
              <Link href="/tasks" className="text-accent-700 hover:text-accent">
                ALL <Num>{total}</Num>
              </Link>
            </span>
          }
        />
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-divider px-[18px] py-3 font-semi text-[12px] text-neutral-500">
          Nothing overdue and nothing burning. An empty panel here is a healthy state.
        </p>
      ) : (
        <ul>
          {rows.map((t) => (
            <li key={t.id} className="border-t border-divider px-[18px] py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={t.clickupUrl ?? `/tasks/${t.id}`}
                    className="line-clamp-2 font-cond text-[15px] text-neutral-900 hover:text-accent"
                  >
                    {t.title}
                  </Link>
                  <p className="hud-label mt-0.5 text-[9px]">
                    {t.deptCode ?? 'NO DEPARTMENT'} · {t.ownerName ?? 'UNOWNED'}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  <Tag tone={t.priority === 'P0' ? 'critical' : t.priority === 'P1' ? 'warning' : 'outline'}>
                    {t.priority}
                  </Tag>
                  {t.daysOverdue > 0 ? (
                    <Tag tone="critical">
                      <Num>{t.daysOverdue}</Num>
                      <span className="ms-1">D LATE</span>
                    </Tag>
                  ) : null}
                  {/*
                    Every field, from the screen he opened to see what needed
                    doing. Walking into the task to move a due date means
                    losing the list that told him to.
                  */}
                  <InlineTaskEditor
                    taskId={t.id}
                    departments={deptOptions}
                    people={peopleOptions}
                  />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </HudCard>
  );
}

/** Who to speak to — clients whose money moved, and deals that have gone quiet. */
async function ClientsCard() {
  const rows = await clientsToCall(8);

  return (
    <HudCard className="gap-0 p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title="Clients to call"
          index="O05"
          action={
            <Link
              href="/pipeline"
              className="font-semi text-[10px] tracking-[0.14em] text-accent-700 hover:text-accent"
            >
              PIPELINE
            </Link>
          }
        />
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-divider px-[18px] py-3 font-semi text-[12px] text-neutral-500">
          Nobody is overdue a conversation.
        </p>
      ) : (
        <ul>
          {rows.map((c) => (
            <li key={c.key} className="border-t border-divider px-[18px] py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-cond text-[15px] text-neutral-900">{c.name}</p>
                  <p className="mt-0.5 font-semi text-[10px] leading-relaxed text-neutral-500">
                    {c.because}
                  </p>
                </div>
                <span className="shrink-0 text-end">
                  {c.moneyCents !== null ? (
                    <span className="font-cond text-[16px] text-neutral-800">
                      <Num>{fmtMoney(c.moneyCents)}</Num>
                    </span>
                  ) : null}
                  <p className="mt-0.5">
                    <Tag tone={c.tone}>{c.reason}</Tag>
                  </p>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </HudCard>
  );
}

function Figure({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="hud-label text-[9px]">{label}</p>
      <p
        className={
          big
            ? 'hud-numeral mt-1 text-[32px] sm:text-[38px]'
            : 'mt-1 font-cond text-[20px] font-medium leading-none text-neutral-800 sm:text-[22px]'
        }
      >
        <Num>{value}</Num>
      </p>
    </div>
  );
}

/**
 * Slack hand-offs nobody has answered. Oldest first — the one that has been
 * sitting longest is the one most likely to have been forgotten.
 */
async function WaitingOnTeamCard() {
  const rows = (await listDelegations('waiting')).sort((a, b) => b.daysQuiet - a.daysQuiet);
  const top = rows.slice(0, 5);

  return (
    <HudCard className="gap-0 p-0">
      <div className="p-[18px] pb-3">
        <HudCardHeader
          title="Waiting on the team"
          index="O02"
          action={
            <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
              <Num>{rows.length}</Num> UNANSWERED ·{' '}
              <Link href="/delegations?view=waiting" className="text-accent-700 hover:text-accent">
                ALL
              </Link>
            </span>
          }
        />
      </div>

      {top.length === 0 ? (
        <p className="border-t border-divider px-[18px] py-4 font-semi text-[12px] text-neutral-500">
          Nothing handed over is waiting for an answer.
        </p>
      ) : (
        <ul>
          {top.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-divider px-[18px] py-2.5"
            >
              <div className="min-w-0">
                <p className="break-words font-cond text-[15px] text-neutral-900">{d.title}</p>
                <p className="hud-label mt-0.5 whitespace-normal text-[9px]">
                  {d.personName}
                  {d.nudgeCount > 0 ? ` · CHASED ${d.nudgeCount}×` : ''}
                </p>
              </div>
              <div className="text-end">
                <span className="hud-label block text-[9px]">QUIET</span>
                <span
                  className={`font-cond text-[19px] leading-none ${
                    d.stuck ? 'text-sev-warning' : 'text-neutral-900'
                  }`}
                >
                  <Num>{d.daysQuiet}d</Num>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </HudCard>
  );
}

/**
 * Mail from somebody the company deals with, where the last word was theirs.
 * Deliberately not the inbox: this is only the part that is on him.
 */
async function WaitingOnYouCard() {
  const [rows, counts] = await Promise.all([mailNeedingReply(5), mailCounts()]);

  return (
    <HudCard className="gap-0 p-0">
      <div className="p-[18px] pb-3">
        <HudCardHeader
          title="Waiting on you"
          index="O03"
          action={
            <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
              <Num>{counts.important}</Num> IMPORTANT ·{' '}
              <Link href="/mail" className="text-accent-700 hover:text-accent">
                ALL MAIL
              </Link>
            </span>
          }
        />
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-divider px-[18px] py-4 font-semi text-[12px] text-neutral-500">
          {counts.lastSyncedAt
            ? 'No important mail is waiting on a reply.'
            : 'The mailbox has not been read yet — the sync runs every fifteen minutes.'}
        </p>
      ) : (
        <ul>
          {rows.map((t) => (
            <li
              key={t.threadId}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-divider px-[18px] py-2.5"
            >
              <div className="min-w-0">
                <a
                  href={t.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-words font-cond text-[15px] text-neutral-900 hover:text-accent"
                >
                  {t.subject || '(no subject)'}
                </a>
                <p className="hud-label mt-0.5 whitespace-normal text-[9px]">
                  {t.counterpartName || t.counterpartEmail}
                  {t.knownCompany ? ` · ${t.knownCompany}` : ''} ·{' '}
                  <Num>{fmtDateTime(t.lastMessageAt)}</Num>
                </p>
              </div>
              <div className="text-end">
                <span className="hud-label block text-[9px]">WAITING</span>
                <span
                  className={`font-cond text-[19px] leading-none ${
                    t.daysWaiting >= 3 ? 'text-sev-warning' : 'text-neutral-900'
                  }`}
                >
                  <Num>{t.daysWaiting}d</Num>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </HudCard>
  );
}

function Skeleton({ title, index }: { title: string; index: string }) {
  return (
    <HudCard>
      <HudCardHeader title={title} index={index} />
      <div className="h-16 animate-pulse bg-neutral-200/40" />
    </HudCard>
  );
}

/**
 * The deals that are slipping.
 *
 * These belong on the home page for the same reason the waiting panels do:
 * they decay. A deal whose next step has come and gone, or with nobody
 * speaking to the other side, does not fail loudly — it simply stops being
 * mentioned. This is the moment he would otherwise have to remember, made to
 * happen daily. The count of suggestions waiting in the inbox rides along,
 * because a proposal nobody looked at is the same kind of silence.
 */
async function SlippingAwayCard() {
  const [attention, inbox] = await Promise.all([
    listPipeline({ attention: true, sort: 'next_step' }),
    inboxOpportunities(),
  ]);
  const rows = attention.slice(0, 5);

  return (
    <HudCard>
      <HudCardHeader
        title="Slipping away"
        index="O04"
        action={
          <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
            <Link href="/pipeline?attention=1" className="text-accent-700 hover:text-accent">
              <Num>{attention.length}</Num> NEED ATTENTION
            </Link>
            {' · '}
            <Link href="/pipeline#inbox" className="text-accent-700 hover:text-accent">
              <Num>{inbox.length}</Num> SUGGESTED
            </Link>
          </span>
        }
      />

      {rows.length === 0 ? (
        <p className="font-semi text-[12px] text-neutral-500">
          {inbox.length > 0
            ? `Every open deal has a next step. ${inbox.length} suggestion${inbox.length === 1 ? '' : 's'} waiting in the inbox.`
            : 'Every open deal has a next step and a recent conversation.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((d) => (
            <li key={d.id} className="border-t border-divider pt-2 first:border-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <Link
                  href={`/pipeline?q=${encodeURIComponent(d.name)}`}
                  className="font-cond text-[15px] leading-none text-neutral-900 hover:text-accent"
                >
                  {d.name}
                </Link>
                <span className="font-cond text-[15px] leading-none text-sev-warning">
                  {d.stepOverdue ? (
                    <>DUE <Num>{d.nextStepDate}</Num></>
                  ) : d.quietDays === null ? (
                    'NO CONVERSATION'
                  ) : (
                    <Num>{d.quietDays}d QUIET</Num>
                  )}
                </span>
              </div>
              <p className="hud-label mt-1 whitespace-normal text-[9px]">
                {STAGE_LABEL[d.stage]}
                {d.nextStep ? ` · ${d.nextStep}` : ' · NO NEXT STEP'}
                {d.valueCents !== null ? <> · <Num>{fmtMoney(d.valueCents)}</Num></> : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </HudCard>
  );
}
