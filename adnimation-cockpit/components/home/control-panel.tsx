import Link from 'next/link';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { Sparkline } from '@/components/revenue/sparkline';
import { fmtDateTime, fmtMoney, fmtNumber } from '@/lib/utils';
import type { ControlPanel as Panel } from '@/lib/control/service';
import { LINE_SOURCE, type LineSummary } from '@/lib/control/lines';

/**
 * The control panel — every line of the business on one strip.
 *
 * Seven tiles, one per stream of money the company runs, each read live from
 * the Ad Ops Architect source and each carrying the same three things: what
 * it made on the last full day, how the week compares to the one before, and
 * the shape of the last four weeks. Below them, the accounts that carry the
 * company, ranked on money.
 *
 * A tile whose source has gone quiet says so rather than showing a zero: on
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
                SEVEN CUTS OF THE BUSINESS — THEY OVERLAP, THEY DO NOT SUM ·{' '}
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
          // Hairlines between tiles: the gap lets the divider colour show through.
          <div className="grid gap-px border-t border-divider bg-divider sm:grid-cols-2 xl:grid-cols-4">
            {panel.lines.map((l) => (
              <LineTile key={l.line} line={l} />
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
                  <Trend pct={c.trendPct} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </HudCard>
    </>
  );
}

function LineTile({ line }: { line: LineSummary }) {
  return (
    <div className="bg-ground p-[14px]">
      <div className="flex items-start justify-between gap-2">
        <p className="hud-label text-[9px]" title={LINE_SOURCE[line.line]}>
          {line.label}
        </p>
        {line.stale ? <Tag tone="warning">SOURCE QUIET</Tag> : <Trend pct={line.trendPct} />}
      </div>

      {line.lastDay === null ? (
        <p className="mt-2 font-semi text-[12px] text-neutral-500">No full day yet.</p>
      ) : (
        <>
          <p className="hud-numeral mt-1 text-[28px]">
            <Num>{fmtMoney(line.grossCents)}</Num>
          </p>
          <p className="font-semi text-[10px] tracking-[0.1em] text-neutral-500">
            GROSS ON <Num>{line.lastDay}</Num>
            {line.profitCents > 0 ? (
              <> · OURS <Num>{fmtMoney(line.profitCents)}</Num></>
            ) : null}
          </p>
          <Sparkline values={line.series} className="mt-2 h-8 w-full text-accent-500" />
          <p className="mt-1 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
            7D <Num>{fmtMoney(line.gross7dCents)}</Num>
            {line.entities !== null && line.unit ? (
              <> · <Num>{fmtNumber(line.entities)}</Num> {line.unit}</>
            ) : null}
            {line.impressions > 0 ? (
              <> · <Num>{fmtNumber(line.impressions)}</Num> IMP</>
            ) : null}
          </p>
        </>
      )}
    </div>
  );
}

/** Week over week, coloured by direction. Nothing at all when there is no prior week. */
function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="hud-label text-[9px] text-neutral-400">NO PRIOR WEEK</span>;
  const tone = pct <= -0.15 ? 'critical' : pct < -0.05 ? 'warning' : pct >= 0.05 ? 'ok' : 'neutral';
  const sign = pct > 0 ? '+' : '';
  return (
    <Tag tone={tone}>
      <Num>{`${sign}${(pct * 100).toFixed(0)}%`}</Num>
      <span className="ms-1">W/W</span>
    </Tag>
  );
}
