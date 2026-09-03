import Link from 'next/link';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { Sparkline } from '@/components/revenue/sparkline';
import { fmtDateTime, fmtMoney, fmtNumber } from '@/lib/utils';
import { PERIOD_LABEL } from '@/lib/revenue/periods';
import type { ControlPanel as Panel } from '@/lib/control/service';
import type { LinePeriodSummary } from '@/lib/control/lines';

/**
 * The control panel — every line of the business, one cube each, across the
 * width of the page.
 *
 * Seven cubes, one per stream of money the company runs, each read from the
 * Ad Ops Architect source and each showing the same window as the company
 * cube above: what it made, what was ours, how that compares with the
 * equivalent earlier window, and the shape of the days inside it. Below them,
 * the accounts that carry the company, ranked on money.
 *
 * A cube whose source has gone quiet says so rather than showing a zero: on
 * this screen a zero reads as a collapse, and a collapse is the one thing he
 * must never be told by accident.
 */
export function ControlPanel({ panel }: { panel: Panel }) {
  return (
    <>
      <HudCard className="gap-0 p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
          <HudCardHeader
            title="Every line"
            index="C01"
            action={
              <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
                {PERIOD_LABEL[panel.period]} · SEVEN CUTS OF THE BUSINESS — THEY OVERLAP, THEY DO NOT SUM ·{' '}
                {panel.pulledAt ? (
                  <>PULLED <Num>{fmtDateTime(panel.pulledAt)}</Num></>
                ) : (
                  'NOT PULLED YET'
                )}
              </span>
            }
          />
        </div>

        {panel.empty ? (
          <p className="border-t border-divider px-[18px] py-4 font-semi text-[12px] text-neutral-500">
            Nothing pulled from the source yet. The activity sync fills this the first time it runs
            with a Lovable API key.
          </p>
        ) : (
          // Seven across on a wide screen, so the whole business is one row.
          // Hairlines between cubes: the gap lets the divider colour show through.
          <div className="grid gap-px border-t border-divider bg-divider sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {panel.lines.map((l) => (
              <LineCube key={l.line} line={l} />
            ))}
          </div>
        )}
      </HudCard>

      <HudCard className="gap-0 p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
          <HudCardHeader
            title="Core clients"
            index="C02"
            action={
              <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
                LAST 7 FULL DAYS · BY GROSS ·{' '}
                <Link href="/revenue" className="text-accent-700 hover:text-accent">
                  REVENUE
                </Link>
              </span>
            }
          />
        </div>

        {panel.coreClients.length === 0 ? (
          <p className="border-t border-divider px-[18px] py-3 font-semi text-[12px] text-neutral-500">
            No account figures yet.
          </p>
        ) : (
          <ol>
            {panel.coreClients.map((c, i) => (
              <li
                key={c.account}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-divider px-[18px] py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="font-cond text-[19px] leading-none text-accent-700">
                    <Num>{String(i + 1).padStart(2, '0')}</Num>
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-cond text-[16px] text-neutral-900">{c.account}</p>
                    <p className="hud-label mt-0.5 text-[9px]">
                      {c.isTrading ? 'TRADING · ' : ''}
                      <Num>{fmtNumber(c.impressions7d)}</Num> IMPRESSIONS
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-end">
                  <div>
                    <p className="font-cond text-[18px] leading-none text-neutral-900">
                      <Num>{fmtMoney(c.gross7dCents)}</Num>
                    </p>
                    <p className="mt-0.5 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
                      OURS <Num>{fmtMoney(c.profit7dCents)}</Num>
                    </p>
                  </div>
                  <Trend pct={c.trendPct} label="W/W" />
                </div>
              </li>
            ))}
          </ol>
        )}
      </HudCard>
    </>
  );
}

function LineCube({ line }: { line: LinePeriodSummary }) {
  const days = line.range.days;
  return (
    <div className="min-w-0 bg-ground p-[12px]">
      <div className="flex items-start justify-between gap-2">
        <p className="hud-label truncate text-[9px]" title={line.source}>
          {line.label}
        </p>
        {line.stale ? <Tag tone="warning">QUIET</Tag> : <Trend pct={line.deltaPct} />}
      </div>

      {line.daysReported === 0 ? (
        <p className="mt-2 font-semi text-[12px] text-neutral-500">
          {line.lastDay ? `Nothing in this window. Last day: ${line.lastDay}.` : 'No days from the source yet.'}
        </p>
      ) : (
        <>
          <p className="hud-numeral mt-1 text-[24px] leading-none">
            <Num>{fmtMoney(line.grossCents)}</Num>
          </p>
          <p className="font-semi text-[10px] tracking-[0.1em] text-neutral-500">
            GROSS
            {line.profitCents > 0 ? (
              <> · OURS <Num>{fmtMoney(line.profitCents)}</Num></>
            ) : null}
          </p>
          <Sparkline values={line.series} className="mt-2 h-7 w-full text-accent-500" />
          <p className="mt-1 truncate font-semi text-[10px] tracking-[0.1em] text-neutral-500">
            <Num>{line.daysReported}</Num>/<Num>{days}</Num> DAYS
            {line.impressions > 0 ? (
              <> · <Num>{fmtNumber(line.impressions)}</Num> IMP</>
            ) : null}
            {line.entities !== null && line.unit ? (
              <> · <Num>{fmtNumber(line.entities)}</Num> {line.unit}</>
            ) : null}
          </p>
        </>
      )}
    </div>
  );
}

/** Against the earlier window, coloured by direction. Nothing when there is nothing to compare. */
function Trend({ pct, label }: { pct: number | null; label?: string }) {
  if (pct === null) return <span className="hud-label text-[9px] text-neutral-400">NO PRIOR</span>;
  const tone = pct <= -0.15 ? 'critical' : pct < -0.05 ? 'warning' : pct >= 0.05 ? 'ok' : 'neutral';
  const sign = pct > 0 ? '+' : '';
  return (
    <Tag tone={tone}>
      <Num>{`${sign}${(pct * 100).toFixed(0)}%`}</Num>
      {label ? <span className="ms-1">{label}</span> : null}
    </Tag>
  );
}
