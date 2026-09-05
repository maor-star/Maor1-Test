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
 * The company, over one window — the strip at the top of the home screen.
 *
 * Every metric the P&L has for the window he picked: gross, net (what
 * Adnimation kept after every payout and fee), the cost between them, margin,
 * impressions, net per day, and how it compares with the equivalent earlier
 * window. The switcher is a row of links, so a window is a URL he can bookmark
 * and the whole page — this strip and every pillar under it — moves together.
 *
 * Deliberately small. It used to take most of the first screen, and the seven
 * pillars — the thing he actually reads down — began below the fold. The
 * company is one line of figures he glances at; the pillars are the work.
 */
export function CompanyCube({ summary, period }: { summary: CompanySummary; period: Period }) {
  const c = summary.company;
  const costCents = Math.max(0, c.grossCents - c.profitCents);

  return (
    <HudCard className="gap-0 overflow-hidden p-0">
      <div className="px-[18px] pb-[10px] pt-[14px]">
        <HudCardHeader title="The company" className="[&_h2]:text-[17px]" action={<PeriodBar period={period} />} />
      </div>

      <div className="border-t border-line px-[18px] py-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="hud-label text-[11px]">{PERIOD_LABEL[period]}</span>
          <span className="hud-label text-[11px] text-neutral-400">
            <Num>{summary.range.current.from}</Num> → <Num>{summary.range.current.to}</Num> ·{' '}
            <Num>{summary.range.days}</Num> day{summary.range.days === 1 ? '' : 'S'}
          </span>
          {summary.range.partial ? <Tag tone="warning">Still filling in</Tag> : null}
          {summary.live ? null : <Tag tone="warning">Built-in snapshot — not synced yet</Tag>}
        </div>

        {/* The two figures he asked for, the same size, then everything else
            the P&L knows for the window in one row. */}
        {/* The package's metric grid: one cell per figure, never a row of
            eight columns crushed together — which is what the eight metrics
            became the moment the figures were set in mono. */}
        {/* Eight figures on one row on a wide screen, so the whole company is
            one glance and the pillars below it start above the fold. */}
        <div className="mt-[10px] grid grid-cols-2 gap-[10px] sm:grid-cols-4 xl:grid-cols-8">
          <Metric label="gross" value={fmtMoney(c.grossCents)} tone="muted" />
          <Metric label="net" value={fmtMoney(c.profitCents)} />
          <Metric label="margin" value={c.marginPct === null ? '—' : `${(c.marginPct * 100).toFixed(1)}%`} tone="info" />
          <Metric label="cost (paid out)" value={fmtMoney(costCents)} />
          <Metric label="impressions" value={fmtNumber(c.impressions)} />
          <Metric label="net / day" value={fmtMoney(c.dailyProfitCents)} />
          <div className="min-w-0 rounded-[10px] border border-line p-[11px]">
            <p className="hud-label truncate text-[10.5px]">{COMPARISON_LABEL[period].toUpperCase()}</p>
            <p className="mt-[7px] text-[17px] leading-none">
              <DeltaPct delta={{ pct: summary.deltaPct, absCents: null }} />
            </p>
          </div>
          <Metric label="previous net / day" value={fmtMoney(summary.previous.dailyProfitCents)} />
        </div>

        <Sparkline
          values={summary.series.map((d) => d.profitCents)}
          className="mt-3 h-9 w-full text-info"
        />
        <p className="hud-label mt-1.5 text-[11px]">Daily net across the window</p>
      </div>

      {/* The four books the P&L keeps, for the same window. Their nets sum to
          the company's; the seven line tiles below do not.

          They used to open the revenue page. That page is gone — it said the
          same things this screen says — so each book states its figures here
          and leads nowhere, rather than to a route that no longer exists. */}
      <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        {summary.lines.map((l) => (
          <div
            key={l.line}
            className="bg-card p-[13px]"
            title={l.label}
          >
            <p className="hud-label text-[11px]">{l.label}</p>
            <p className="mt-[7px] text-[18px] font-semibold leading-none text-ink">
              <Num>{fmtMoney(l.profitCents)}</Num>
              <span className="ms-2 text-[11.5px] font-bold uppercase tracking-[0.09em] text-muted">
                Net
              </span>
            </p>
            <p className="mt-2 text-[12.5px] text-muted">
              Gross <Num>{fmtMoney(l.grossCents)}</Num> · <Num>{(l.shareOfProfit * 100).toFixed(0)}%</Num> OF NET ·{' '}
              <Num>{l.marginPct === null ? '—' : `${(l.marginPct * 100).toFixed(0)}%`}</Num> margin
            </p>
          </div>
        ))}
      </div>

      <p className="border-t border-line px-[18px] py-2 text-[12px] text-muted">
        Last full day <Num>{summary.lastCompleteDay}</Num> · pulled{' '}
        <Num>{fmtDateTime(new Date(summary.pulledAt))}</Num>
      </p>
    </HudCard>
  );
}

/**
 * The window switcher, as the package's segmented control: one tray, and the
 * chosen window lifted out of it in white. Still links, so a period is a URL
 * he can bookmark and the whole page moves with it.
 */
export function PeriodBar({ period, base = '/' }: { period: Period; base?: string }) {
  return (
    <nav className="segmented flex-wrap" aria-label="Time window">
      {PERIODS.map((p) => (
        <Link
          key={p}
          href={`${base}?period=${p}`}
          aria-current={p === period ? 'page' : undefined}
        >
          {PERIOD_TAB[p]}
        </Link>
      ))}
    </nav>
  );
}

/** One metric cell: a small card, an uppercase label, a mono figure. */
function Metric({
  label,
  value,
  big,
  tone,
}: {
  label: string;
  value: string;
  big?: boolean;
  tone?: 'muted' | 'info';
}) {
  return (
    <div className="min-w-0 rounded-[10px] border border-line p-[11px]">
      <p className="hud-label truncate text-[10.5px]">{label}</p>
      <p
        className={`hud-numeral mt-[7px] truncate ${big ? 'text-[21px]' : 'text-[17px]'} ${
          tone === 'muted' ? 'text-neutral-700' : tone === 'info' ? 'text-info' : ''
        }`}
      >
        <Num>{value}</Num>
      </p>
    </div>
  );
}
