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
      <HudCard className="gap-0 overflow-hidden p-0">
        <div className="p-[22px] pb-[14px]">
          <HudCardHeader
            title="Every line"
            action={
              <span className="text-[12.5px] text-muted">
                {PERIOD_LABEL[panel.period]} · seven cuts of the business — they overlap, they do
                not sum ·{' '}
                {panel.pulledAt ? (
                  <>pulled <Num>{fmtDateTime(panel.pulledAt)}</Num></>
                ) : (
                  'not pulled yet'
                )}
              </span>
            }
          />
        </div>

        {panel.empty ? (
          <p className="border-t border-line px-[22px] py-4 text-[14.5px] text-muted">
            Nothing pulled from the source yet. The activity sync fills this the first time it runs
            with a Lovable API key.
          </p>
        ) : (
          /*
           * Four across at most. Seven in a row was possible while every label
           * was nine-pixel condensed type; with the package's 12px labels and
           * mono figures it truncated every heading and pushed the row off the
           * card, which is worse than a second line of tiles.
           */
          <div className="grid gap-[14px] border-t border-line p-[18px] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {panel.lines.map((l) => (
              <LineCube key={l.line} line={l} />
            ))}
          </div>
        )}
      </HudCard>

      <HudCard className="gap-0 overflow-hidden p-0">
        <div className="p-[22px] pb-[14px]">
          <HudCardHeader
            title="Core clients"
            action={
              <span className="text-[12.5px] text-muted">
                Last 7 full days · by gross ·{' '}
                <Link href="/revenue" className="font-semibold text-info hover:underline">
                  Revenue
                </Link>
              </span>
            }
          />
        </div>

        {panel.coreClients.length === 0 ? (
          <p className="border-t border-line px-[22px] py-3 text-[14.5px] text-muted">
            No account figures yet.
          </p>
        ) : (
          <ol>
            {panel.coreClients.map((c, i) => (
              <li
                key={c.account}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-[22px] py-3 transition-colors hover:bg-neutral-100"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="font-mono text-[15px] leading-none text-neutral-400">
                    <Num>{String(i + 1).padStart(2, '0')}</Num>
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[15.5px] font-semibold text-ink">{c.account}</p>
                    <p className="hud-label mt-1 text-[11.5px]">
                      {c.isTrading ? 'TRADING · ' : ''}
                      <Num>{fmtNumber(c.impressions7d)}</Num> Impressions
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-end">
                  <div>
                    <p className="hud-numeral text-[19px]">
                      <Num>{fmtMoney(c.gross7dCents)}</Num>
                    </p>
                    <p className="mt-1 text-[12.5px] text-muted">
                      ours <Num>{fmtMoney(c.profit7dCents)}</Num>
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
    <div className="min-w-0 rounded-[12px] border border-line p-[17px]">
      <div className="flex items-start justify-between gap-2">
        <p className="hud-label truncate text-[12px]" title={line.source}>
          {line.label}
        </p>
        {line.stale ? <Tag tone="warning">quiet</Tag> : <Trend pct={line.deltaPct} />}
      </div>

      {line.daysReported === 0 ? (
        <p className="mt-3 text-[14px] text-muted">
          {line.lastDay ? `Nothing in this window. Last day: ${line.lastDay}.` : 'No days from the source yet.'}
        </p>
      ) : (
        <>
          <p className="hud-numeral mt-3 text-[26px]">
            <Num>{fmtMoney(line.grossCents)}</Num>
          </p>
          <p className="mt-2 text-[12.5px] text-muted">
            gross
            {line.profitCents > 0 ? (
              <> · ours <Num>{fmtMoney(line.profitCents)}</Num></>
            ) : null}
          </p>
          <Sparkline values={line.series} className="mt-3 h-8 w-full text-info" />
          <p className="mt-2 truncate text-[12.5px] text-muted">
            <Num>{line.daysReported}</Num>/<Num>{days}</Num> days
            {line.impressions > 0 ? (
              <> · <Num>{fmtNumber(line.impressions)}</Num> imp</>
            ) : null}
            {line.entities !== null && line.unit ? (
              <> · <Num>{fmtNumber(line.entities)}</Num> {line.unit.toLowerCase()}</>
            ) : null}
          </p>
        </>
      )}
    </div>
  );
}

/** Against the earlier window, coloured by direction. Nothing when there is nothing to compare. */
function Trend({ pct, label }: { pct: number | null; label?: string }) {
  if (pct === null) return <span className="hud-label text-[11.5px] text-neutral-400">No prior</span>;
  const tone = pct <= -0.15 ? 'critical' : pct < -0.05 ? 'warning' : pct >= 0.05 ? 'ok' : 'neutral';
  const sign = pct > 0 ? '+' : '';
  return (
    <Tag tone={tone}>
      <Num>{`${sign}${(pct * 100).toFixed(0)}%`}</Num>
      {label ? <span className="ms-1">{label}</span> : null}
    </Tag>
  );
}
