import Link from 'next/link';
import { loadRevenueView } from '@/lib/revenue/service';
import { DEPT_LABEL } from '@/lib/revenue/labels';
import { todayInTz, fmtMoney } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { Sparkline } from './sparkline';
import { DeltaPct } from './delta';

/**
 * Cockpit strip 1 (spec §5): yesterday's net, the three comparisons, and the
 * department cards sorted highest first with a 30-day sparkline behind each.
 */
export async function RevenueStrip({ basis = 'net' }: { basis?: 'net' | 'gross' }) {
  const today = todayInTz();
  const { summary, date } = await loadRevenueView(today, basis);

  if (!summary || !date) {
    return (
      <HudCard>
        <HudCardHeader title="Revenue" index="R01" />
        <p className="font-semi text-[12px] text-neutral-500">No complete day of data yet.</p>
      </HudCard>
    );
  }

  const headline = basis === 'net' ? summary.totalNetCents : summary.totalGrossCents;

  return (
    <HudCard>
      <HudCardHeader
        title="Revenue / last full day"
        index="R01"
        action={
          <div className="flex items-center gap-3">
            {summary.mappingNeedsReview ? (
              <Link href="/revenue#mapping">
                <Tag tone="watch" title="Category-to-department mapping is not confirmed">
                  MAPPING UNCONFIRMED
                </Tag>
              </Link>
            ) : null}
            <Link
              href="/revenue"
              className="font-semi text-[11px] tracking-[0.16em] text-accent-700 hover:text-accent"
            >
              FULL BREAKDOWN
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          <p className="hud-label text-[10px]">
            {basis === 'net' ? 'NET' : 'GROSS'} · <Num>{date}</Num>
          </p>
          <p className="hud-numeral mt-1 text-[38px]">
            <Num>{fmtMoney(headline)}</Num>
          </p>
        </div>

        <Comparison label="VS PREV DAY" delta={summary.vsPrevDay} />
        <Comparison label="VS SAME DAY LAST WEEK" delta={summary.vsSameDayLastWeek} />
        <Comparison label="VS 7-DAY AVG" delta={summary.vsSevenDayAvg} />

        <div className="flex gap-6">
          <Metric label="GROSS" value={fmtMoney(summary.totalGrossCents)} />
          <Metric
            label="TAKE RATE"
            value={summary.takeRate === null ? '—' : `${(summary.takeRate * 100).toFixed(1)}%`}
          />
          <Metric label="ECPM" value={fmtMoney(summary.ecpmCents)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.depts.map((d) => {
          const value = basis === 'net' ? d.netCents : d.grossCents;
          const code = d.deptCode ?? 'UNASSIGNED';
          return (
            <Link
              key={code}
              href={`/revenue?dept=${code}`}
              className="relative overflow-hidden border border-divider bg-ground p-3 hover:border-accent/60 hover:bg-ink/[0.04]"
            >
              <Sparkline
                values={d.spark}
                className="pointer-events-none absolute inset-x-0 bottom-0 h-10 w-full text-accent-500/25"
              />
              <div className="relative">
                <p className="flex items-center gap-2 hud-label text-[9px] tracking-[0.14em]">
                  {DEPT_LABEL[code] ?? code}
                  {d.deptCode === null ? <Tag tone="watch">NO RULE</Tag> : null}
                </p>
                <p className="hud-numeral mt-1 text-[26px]">
                  <Num>{fmtMoney(value)}</Num>
                </p>
                <div className="mt-1 flex gap-3">
                  <DeltaPct delta={d.vsPrevDay} label="D" />
                  <DeltaPct delta={d.vsSameDayLastWeek} label="W" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {summary.anomalies.length > 0 ? (
        <ul className="border-t border-divider pt-3">
          {summary.anomalies.slice(0, 3).map((a) => (
            <li
              key={`${a.scopeId}-${a.kind}`}
              className="grid grid-cols-[3px_1fr] gap-3 border-t border-ink/[0.09] py-2 first:border-t-0"
            >
              <span
                className={
                  a.severity === 'critical'
                    ? 'bg-sev-critical'
                    : a.severity === 'warning'
                      ? 'bg-sev-warning'
                      : 'bg-sev-watch'
                }
              />
              <div>
                <p className="font-cond text-[12px] font-semibold tracking-[0.22em] text-neutral-800">
                  {a.severity === 'critical' ? 'CRITICAL' : a.severity === 'warning' ? 'WARNING' : 'REVIEW'}
                </p>
                <p className="mt-0.5 text-[13px] leading-[1.45] text-neutral-700">{a.whatHappened}</p>
                <p className="mt-0.5 font-semi text-[11px] tracking-[0.1em] text-neutral-500">
                  IMPACT <Num>{fmtMoney(a.moneyImpactCents)}</Num> · {a.recommendedAction}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </HudCard>
  );
}

function Comparison({
  label,
  delta,
}: {
  label: string;
  delta: Parameters<typeof DeltaPct>[0]['delta'];
}) {
  return (
    <div>
      <p className="hud-label text-[9px]">{label}</p>
      <p className="mt-1">
        <DeltaPct delta={delta} />
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="hud-label text-[9px]">{label}</p>
      <p className="mt-1 font-cond text-[20px] font-medium leading-none text-neutral-800">
        <Num>{value}</Num>
      </p>
    </div>
  );
}
