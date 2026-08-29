import { Suspense } from 'react';
import Link from 'next/link';
import { summariseCompany } from '@/lib/revenue/company';
import { topSeats } from '@/lib/seats/service';
import { urgentWork, clientsToCall } from '@/lib/overview/service';
import { PERIOD_LABEL } from '@/lib/revenue/periods';
import { fmtMoney } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { DeltaPct } from '@/components/revenue/delta';
import { Sparkline } from '@/components/revenue/sparkline';

export const dynamic = 'force-dynamic';

/**
 * The overview — the whole company on one screen.
 *
 * Five questions, in the order a CEO asks them: what did we make, which supply
 * is carrying us, which demand is carrying us, what is urgent, and who needs a
 * call. Everything below is a real figure from a real source; a panel with no
 * data says so rather than showing a zero that reads like a collapse.
 */
export default function OverviewPage() {
  return (
    <div className="space-y-5">
      <PageHeader kicker="OVERVIEW / 01" title="The company" />

      <Suspense fallback={<Skeleton title="Profit" index="O01" />}>
        <ProfitStrip />
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
  const { rows, overdue, burning, total } = await urgentWork(8);

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

function Skeleton({ title, index }: { title: string; index: string }) {
  return (
    <HudCard>
      <HudCardHeader title={title} index={index} />
      <div className="h-16 animate-pulse bg-neutral-200/40" />
    </HudCard>
  );
}
