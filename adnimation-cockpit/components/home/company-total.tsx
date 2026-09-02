import Link from 'next/link';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { Num } from '@/components/num';
import { Sparkline } from '@/components/revenue/sparkline';
import { PARTIAL_PERIODS, PERIOD_LABEL, type Period } from '@/lib/revenue/periods';
import { fmtMoney, fmtNumber } from '@/lib/utils';
import type { CompanySummary } from '@/lib/revenue/company';

/**
 * The whole company, on one panel, in the time units he thinks in.
 *
 * Above the seven lines, because the lines are seven different cuts — a set of
 * accounts, two formats, a device, a partner arrangement — and they overlap on
 * purpose. Adding the tiles up does not give the company; this does. It is the
 * P&L: publishers, the bidder, seat lease and the exchange, each counted once.
 *
 * Every period is on screen at once rather than behind a switcher. He does not
 * open this to look up one number, he opens it to see whether the month is
 * tracking the week — and that comparison cannot be made one click at a time.
 */
export function CompanyTotal({
  periods,
  headline,
}: {
  periods: { period: Period; summary: CompanySummary }[];
  /** The period the big figures and the chart are drawn from. */
  headline: CompanySummary;
}) {
  return (
    <HudCard className="gap-0 p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title="The whole company"
          index="C00"
          action={
            <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
              PUBLISHERS · BIDDER · SEAT LEASE · EXCHANGE, EACH COUNTED ONCE ·{' '}
              <Link href="/revenue" className="text-accent-700 hover:text-accent">
                THE BREAKDOWN ↗
              </Link>
            </span>
          }
        />
      </div>

      <div className="grid gap-4 border-t border-divider p-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          {/* Gross and net side by side, the same size: he asked for the sum
              of both, not one with the other as a footnote. Net is what
              Adnimation kept after every payout and fee — the P&L's profit. */}
          <div className="grid grid-cols-2 gap-x-6">
            <div>
              <p className="hud-label text-[9px]">{PERIOD_LABEL[headline.range.period]} · GROSS</p>
              <p className="hud-numeral mt-1 text-[32px] leading-none text-neutral-700">
                <Num>{fmtMoney(headline.company.grossCents)}</Num>
              </p>
            </div>
            <div>
              <p className="hud-label text-[9px]">{PERIOD_LABEL[headline.range.period]} · NET</p>
              <p className="hud-numeral mt-1 text-[32px] leading-none">
                <Num>{fmtMoney(headline.company.profitCents)}</Num>
              </p>
            </div>
          </div>
          <p className="mt-1 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
            NET IS WHAT WE KEPT
            {headline.company.marginPct !== null ? (
              <>
                {' · '}
                <Num>{(headline.company.marginPct * 100).toFixed(1)}%</Num> OF GROSS
              </>
            ) : null}
          </p>
          <Sparkline
            values={headline.series.map((d) => d.profitCents)}
            className="mt-3 h-10 w-full text-accent-500"
          />
          <p className="mt-1 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
            DAILY NET, TO <Num>{headline.lastCompleteDay}</Num>
            {headline.live ? '' : ' · FROM THE BUILT-IN SNAPSHOT, NOT YET SYNCED'}
          </p>
        </div>

        {/* Every unit of time at once: the point is the comparison between
            them, and a switcher makes that impossible. Gross and net on every
            tile, in that order, the same on every tile. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {periods.map(({ period, summary }) => (
            <Link
              key={period}
              href={`/revenue?period=${period}`}
              className="group min-w-0"
              title={`${PERIOD_LABEL[period]} — open the breakdown`}
            >
              <p className="hud-label text-[9px] group-hover:text-accent">
                {PERIOD_LABEL[period]}
                {PARTIAL_PERIODS.includes(period) ? ' · SO FAR' : ''}
              </p>
              <p className="mt-0.5 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
                GROSS <span className="font-cond text-[17px] tracking-normal text-neutral-700"><Num>{fmtMoney(summary.company.grossCents)}</Num></span>
              </p>
              <p className="font-semi text-[10px] tracking-[0.1em] text-neutral-500">
                NET <span className="font-cond text-[21px] tracking-normal text-neutral-900 group-hover:text-accent"><Num>{fmtMoney(summary.company.profitCents)}</Num></span>
              </p>
              <p className="mt-0.5 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
                {summary.deltaPct !== null ? (
                  <span
                    className={
                      summary.deltaPct >= 0 ? ' text-sev-ok' : ' text-sev-warning'
                    }
                  >
                    {' · '}
                    <Num>{`${summary.deltaPct > 0 ? '+' : ''}${Math.round(summary.deltaPct * 100)}%`}</Num>
                  </span>
                ) : null}
              </p>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-px border-t border-divider bg-divider sm:grid-cols-2 xl:grid-cols-4">
        {headline.lines.map((l) => (
          <div key={l.label} className="bg-ground p-[14px]">
            <p className="hud-label text-[9px]">{l.label}</p>
            <p className="mt-1 font-cond text-[22px] leading-none text-neutral-900">
              <Num>{fmtMoney(l.profitCents)}</Num>
            </p>
            <p className="mt-0.5 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
              <Num>{fmtMoney(l.grossCents)}</Num> GROSS ·{' '}
              <Num>{Math.round(l.shareOfProfit * 100)}%</Num> OF PROFIT
              {l.impressions > 0 ? (
                <>
                  {' · '}
                  <Num>{fmtNumber(l.impressions)}</Num> IMP
                </>
              ) : null}
            </p>
          </div>
        ))}
      </div>
    </HudCard>
  );
}
