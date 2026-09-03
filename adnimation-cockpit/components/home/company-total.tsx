import Link from 'next/link';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { DeltaPct } from '@/components/revenue/delta';
import { Sparkline } from '@/components/revenue/sparkline';
import { fmtDateTime, fmtMoney, fmtNumber } from '@/lib/utils';
import type { CompanySummary } from '@/lib/revenue/company';
import {
  COMPARISON_LABEL, PERIODS, PERIOD_LABEL, PERIOD_TAB, type Period,
} from '@/lib/revenue/periods';

/**
 * The company, over one window — the cube at the top of the home screen.
 *
 * Every metric the P&L has for the window he picked, in one place: gross,
 * net (what Adnimation kept after every payout and fee), the cost between
 * them, margin, impressions, net per day, and how it compares with the
 * equivalent earlier window. The switcher is a row of links, so a window is
 * a URL he can bookmark and the whole page — this cube and every line tile
 * under it — moves together.
 */
export function CompanyCube({ summary, period }: { summary: CompanySummary; period: Period }) {
  const c = summary.company;
  const costCents = Math.max(0, c.grossCents - c.profitCents);

  return (
    <HudCard className="gap-0 p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title="The company"
          index="C00"
          action={<PeriodBar period={period} />}
        />
      </div>

      <div className="border-t border-divider p-[18px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="hud-label text-[9px]">{PERIOD_LABEL[period]}</span>
          <span className="hud-label text-[9px] text-neutral-400">
            <Num>{summary.range.current.from}</Num> → <Num>{summary.range.current.to}</Num> ·{' '}
            <Num>{summary.range.days}</Num> DAY{summary.range.days === 1 ? '' : 'S'}
          </span>
          {summary.range.partial ? <Tag tone="warning">STILL FILLING IN</Tag> : null}
          {summary.live ? null : <Tag tone="warning">BUILT-IN SNAPSHOT — NOT SYNCED YET</Tag>}
        </div>

        {/* The two figures he asked for, the same size, then everything else
            the P&L knows for the window in one row. */}
        <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4 xl:grid-cols-8">
          <Metric label="GROSS" value={fmtMoney(c.grossCents)} big tone="muted" />
          <Metric label="NET" value={fmtMoney(c.profitCents)} big />
          <Metric label="MARGIN" value={c.marginPct === null ? '—' : `${(c.marginPct * 100).toFixed(1)}%`} />
          <Metric label="COST (PAID OUT)" value={fmtMoney(costCents)} />
          <Metric label="IMPRESSIONS" value={fmtNumber(c.impressions)} />
          <Metric label="NET / DAY" value={fmtMoney(c.dailyProfitCents)} />
          <div className="min-w-0">
            <p className="hud-label text-[9px]">{COMPARISON_LABEL[period].toUpperCase()}</p>
            <p className="mt-1 font-cond text-[20px] leading-none">
              <DeltaPct delta={{ pct: summary.deltaPct, absCents: null }} />
            </p>
          </div>
          <Metric label="PREVIOUS NET / DAY" value={fmtMoney(summary.previous.dailyProfitCents)} />
        </div>

        <Sparkline
          values={summary.series.map((d) => d.profitCents)}
          className="mt-3 h-12 w-full text-accent-500"
        />
        <p className="hud-label mt-1 text-[9px] text-neutral-400">DAILY NET ACROSS THE WINDOW</p>
      </div>

      {/* The four books the P&L keeps, for the same window. Their nets sum to
          the company's; the seven line tiles below do not. */}
      <div className="grid gap-px border-t border-divider bg-divider sm:grid-cols-2 xl:grid-cols-4">
        {summary.lines.map((l) => (
          <Link
            key={l.line}
            href={`/revenue?period=${period}`}
            className="group bg-ground p-[14px]"
            title={`${l.label} — open the breakdown`}
          >
            <p className="hud-label text-[9px] group-hover:text-accent">{l.label}</p>
            <p className="mt-1 font-cond text-[22px] leading-none text-neutral-900 group-hover:text-accent">
              <Num>{fmtMoney(l.profitCents)}</Num>
              <span className="ms-1 text-[10px] text-neutral-500">NET</span>
            </p>
            <p className="mt-0.5 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
              GROSS <Num>{fmtMoney(l.grossCents)}</Num> · <Num>{(l.shareOfProfit * 100).toFixed(0)}%</Num> OF NET ·{' '}
              <Num>{l.marginPct === null ? '—' : `${(l.marginPct * 100).toFixed(0)}%`}</Num> MARGIN
            </p>
          </Link>
        ))}
      </div>

      <p className="border-t border-divider px-[18px] py-2 font-semi text-[10px] tracking-[0.12em] text-neutral-500">
        LAST FULL DAY <Num>{summary.lastCompleteDay}</Num> · PULLED{' '}
        <Num>{fmtDateTime(new Date(summary.pulledAt))}</Num> ·{' '}
        <Link href={`/revenue?period=${period}`} className="text-accent-700 hover:text-accent">
          FULL BREAKDOWN
        </Link>
      </p>
    </HudCard>
  );
}

/** The window switcher: links, so a period is a URL. */
export function PeriodBar({ period, base = '/' }: { period: Period; base?: string }) {
  return (
    <nav className="flex flex-wrap gap-1" aria-label="Time window">
      {PERIODS.map((p) => (
        <Link
          key={p}
          href={`${base}?period=${p}`}
          className={`px-2 py-1 font-semi text-[10px] tracking-[0.14em] ${
            p === period ? 'bg-accent text-ground' : 'text-neutral-500 hover:text-accent'
          }`}
          aria-current={p === period ? 'page' : undefined}
        >
          {PERIOD_TAB[p]}
        </Link>
      ))}
    </nav>
  );
}

function Metric({ label, value, big, tone }: { label: string; value: string; big?: boolean; tone?: 'muted' }) {
  return (
    <div className="min-w-0">
      <p className="hud-label text-[9px]">{label}</p>
      <p
        className={
          big
            ? `hud-numeral mt-1 text-[30px] leading-none sm:text-[34px] ${tone === 'muted' ? 'text-neutral-700' : ''}`
            : 'mt-1 font-cond text-[20px] font-medium leading-none text-neutral-800'
        }
      >
        <Num>{value}</Num>
      </p>
    </div>
  );
}
