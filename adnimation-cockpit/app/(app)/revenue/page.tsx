import Link from 'next/link';
import {
  lastCompleteDay, partialDay, summariseAllPeriods, summariseForPeriod,
} from '@/lib/revenue/period-service';
import {
  COMPARISON_LABEL, PERIODS, PERIOD_LABEL, PERIOD_TAB, isPeriod, type Period,
} from '@/lib/revenue/periods';
import { fmtMoney, fmtNumber } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { Sparkline } from '@/components/revenue/sparkline';
import { DeltaPct } from '@/components/revenue/delta';

export const dynamic = 'force-dynamic';

/**
 * Revenue across the standard windows, split by the departments the source
 * itself uses (see lib/revenue/departments.ts).
 *
 * Every figure on this page is summed from real daily rows pulled read-only
 * from the Ad Ops Architect system. Nothing is estimated, and today's column is
 * labelled partial because the source is still receiving it.
 */
export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const sp = await searchParams;
  const period: Period = isPeriod(sp.period) ? sp.period : '30D';
  const [day, today] = await Promise.all([lastCompleteDay(), partialDay()]);

  if (!day) {
    return (
      <div className="space-y-5">
        <PageHeader kicker="REVENUE / 02" title="Revenue" />
        <p className="font-semi text-[12px] text-neutral-500">No revenue data yet.</p>
      </div>
    );
  }

  const s = await summariseForPeriod(period);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="REVENUE / 02"
        title="Revenue"
        action={
          <nav className="flex flex-wrap border border-divider">
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={`/revenue?period=${p}`}
                className={`px-[9px] py-1 font-semi text-[11px] tracking-[0.12em] ${
                  p === period ? 'bg-accent text-ground' : 'text-neutral-500 hover:text-accent'
                }`}
              >
                {PERIOD_TAB[p]}
              </Link>
            ))}
          </nav>
        }
      />

      <HudCard>
        <HudCardHeader
          title={PERIOD_LABEL[period]}
          index="F01"
          action={
            <span className="flex items-center gap-2">
              {s.range.partial ? (
                <Tag tone="watch" title="The source is still receiving this day; it will keep rising">
                  PARTIAL DAY
                </Tag>
              ) : null}
              <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
                <Num>{s.range.current.from}</Num> — <Num>{s.range.current.to}</Num> ·{' '}
                <Num>{s.current.days}</Num> DAYS · SOURCE: AD OPS ARCHITECT (READ-ONLY)
              </span>
            </span>
          }
        />

        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <Figure label="NET" value={fmtMoney(s.current.netCents)} big />
          <Figure label="GROSS" value={fmtMoney(s.current.grossCents)} />
          <Figure
            label="TAKE RATE"
            value={s.current.takeRate === null ? '—' : `${(s.current.takeRate * 100).toFixed(1)}%`}
          />
          <Figure label="IMPRESSIONS" value={fmtNumber(s.current.impressions)} />
          <Figure label="ECPM" value={fmtMoney(s.current.ecpmCents)} />
          <Figure label="NET / DAY" value={fmtMoney(s.current.dailyNetCents)} />

          <div>
            <p className="hud-label text-[9px]">{COMPARISON_LABEL[period].toUpperCase()}</p>
            <p className="mt-1">
              <DeltaPct delta={{ pct: s.deltaPct, absCents: null }} />
            </p>
            <p className="mt-1 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
              {s.previous.days > 0 ? (
                <>
                  WAS <Num>{fmtMoney(s.previous.netCents)}</Num> OVER <Num>{s.previous.days}</Num> DAYS
                </>
              ) : (
                'NO COMPARABLE PERIOD IN THE DATA'
              )}
            </p>
          </div>
        </div>

        <Sparkline
          values={s.series.map((d) => d.netCents)}
          className="mt-1 h-14 w-full text-accent-500"
        />
        <div className="flex justify-between font-semi text-[10px] tracking-[0.12em] text-neutral-500">
          <Num>{s.range.current.from}</Num>
          <Num>{s.range.current.to}</Num>
        </div>
      </HudCard>

      <HudCard className="p-0">
        <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
          <HudCardHeader
            title="By department"
            index="F02"
            action={
              <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                AS THE SOURCE GROUPS IT
              </span>
            }
          />
        </div>
        <div className="min-w-0 overflow-x-auto">
          <table className="cockpit-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Net</th>
                <th>Gross</th>
                <th>Take</th>
                <th>Impressions</th>
                <th>eCPM</th>
                <th>Share of net</th>
                <th className="text-end">{COMPARISON_LABEL[period]}</th>
              </tr>
            </thead>
            <tbody>
              {s.depts.map((d) => (
                <tr key={d.deptCode}>
                  <td className="font-cond text-[17px] text-neutral-900">{d.label}</td>
                  <td className="font-cond text-[17px] text-neutral-900">
                    <Num>{fmtMoney(d.netCents)}</Num>
                  </td>
                  <td className="text-neutral-500"><Num>{fmtMoney(d.grossCents)}</Num></td>
                  <td className="text-neutral-500">
                    <Num>{d.takeRate === null ? '—' : `${(d.takeRate * 100).toFixed(0)}%`}</Num>
                  </td>
                  <td className="text-neutral-500"><Num>{fmtNumber(d.impressions)}</Num></td>
                  <td className="text-neutral-500"><Num>{fmtMoney(d.ecpmCents)}</Num></td>
                  <td>
                    <span className="flex items-center gap-2">
                      <span className="hud-gauge w-20">
                        <span
                          className="block h-full bg-accent"
                          style={{ width: `${Math.round(d.share * 100)}%` }}
                        />
                      </span>
                      <Num className="text-neutral-500">{(d.share * 100).toFixed(1)}%</Num>
                    </span>
                  </td>
                  <td className="text-end">
                    <DeltaPct delta={{ pct: d.deltaPct, absCents: null }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </HudCard>

      <AllPeriods active={period} />

      <p className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
        SOURCE: AD OPS ARCHITECT (LOVABLE) · READ-ONLY · PULLED <Num>{s.pulledAt}</Num> · LAST
        COMPLETE DAY <Num>{day}</Num> · TODAY <Num>{today}</Num> IS PARTIAL
      </p>
    </div>
  );
}

/** Every window side by side — the answer to "how are we doing" without clicking. */
async function AllPeriods({ active }: { active: Period }) {
  const all = await summariseAllPeriods(PERIODS);

  return (
    <HudCard className="p-0">
      <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader title="Every window" index="F03" />
      </div>
      <div className="min-w-0 overflow-x-auto">
        <table className="cockpit-table">
          <thead>
            <tr>
              <th>Window</th>
              <th>Range</th>
              <th>Days</th>
              <th>Net</th>
              <th>Gross</th>
              <th>Take</th>
              <th>Net / day</th>
              <th className="text-end">Change</th>
            </tr>
          </thead>
          <tbody>
            {all.map((p) => (
              <tr key={p.period} className={p.period === active ? 'bg-accent-100/40' : undefined}>
                <td className="font-cond text-[17px] text-neutral-900">
                  <Link href={`/revenue?period=${p.period}`} className="hover:text-accent">
                    {PERIOD_LABEL[p.period]}
                  </Link>
                  {p.range.partial ? <Tag tone="watch" className="ms-2">PARTIAL</Tag> : null}
                </td>
                <td className="text-[11px] text-neutral-500">
                  <Num>{p.range.current.from}</Num> → <Num>{p.range.current.to}</Num>
                </td>
                <td className="text-neutral-500"><Num>{p.current.days}</Num></td>
                <td className="font-cond text-[17px] text-neutral-900">
                  <Num>{fmtMoney(p.current.netCents)}</Num>
                </td>
                <td className="text-neutral-500"><Num>{fmtMoney(p.current.grossCents)}</Num></td>
                <td className="text-neutral-500">
                  <Num>
                    {p.current.takeRate === null ? '—' : `${(p.current.takeRate * 100).toFixed(0)}%`}
                  </Num>
                </td>
                <td className="text-neutral-500"><Num>{fmtMoney(p.current.dailyNetCents)}</Num></td>
                <td className="text-end">
                  <DeltaPct delta={{ pct: p.deltaPct, absCents: null }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-divider px-[18px] py-2 font-semi text-[10px] tracking-[0.12em] text-neutral-500">
        EVERY ROW IS SUMMED FROM DAILY SOURCE ROWS — NO ESTIMATES, NO PRORATING
      </p>
    </HudCard>
  );
}

function Figure({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <p className="hud-label text-[9px]">{label}</p>
      <p
        className={
          big
            ? 'hud-numeral mt-1 text-[38px]'
            : 'mt-1 font-cond text-[22px] font-medium leading-none text-neutral-800'
        }
      >
        <Num>{value}</Num>
      </p>
    </div>
  );
}
