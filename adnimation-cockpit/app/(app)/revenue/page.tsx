import Link from 'next/link';
import { lastCompleteDay, summariseForPeriod } from '@/lib/revenue/period-service';
import { COMPARISON_LABEL, PERIODS, PERIOD_LABEL, isPeriod, type Period } from '@/lib/revenue/periods';
import { DEPT_LABEL } from '@/lib/revenue/labels';
import { CATEGORY_LABEL } from '@/lib/revenue/types';
import { DEFAULT_DEPT_MAPPING, UNMAPPED_DEPTS } from '@/lib/revenue/mapping';
import { fmtMoney, fmtNumber } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { Sparkline } from '@/components/revenue/sparkline';
import { DeltaPct } from '@/components/revenue/delta';

export const dynamic = 'force-dynamic';

/** Spec 7.3 — the revenue overview across the standard time windows. */
export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const sp = await searchParams;
  const period: Period = isPeriod(sp.period) ? sp.period : '30D';
  const day = await lastCompleteDay();

  if (!day) {
    return (
      <div className="space-y-5">
        <PageHeader kicker="REVENUE / 02" title="Revenue" />
        <p className="font-semi text-[12px] text-neutral-500">No revenue data yet.</p>
      </div>
    );
  }

  const s = await summariseForPeriod(period, day);

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
                className={`px-3 py-1 font-semi text-[11px] tracking-[0.16em] ${
                  p === period ? 'bg-accent text-ground' : 'text-neutral-500 hover:text-accent'
                }`}
              >
                {p}
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
            <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
              <Num>{s.range.current.from}</Num> — <Num>{s.range.current.to}</Num> ·{' '}
              <Num>{s.current.days}</Num> DAYS · SOURCE: AD OPS ARCHITECT (READ-ONLY)
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
          <HudCardHeader title="By department" index="F02" />
          {!s.deptsExact ? (
            <Tag tone="watch" title="This window does not start on a month boundary">
              WHOLE MONTHS
            </Tag>
          ) : null}
        </div>
        <div className="min-w-0 overflow-x-auto">
          <table className="cockpit-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Net</th>
                <th>Gross</th>
                <th>Impressions</th>
                <th>eCPM</th>
                <th>Share of net</th>
                <th className="whitespace-normal">Demand sources</th>
              </tr>
            </thead>
            <tbody>
              {s.depts.map((d) => {
                const share = s.current.netCents > 0 ? d.netCents / s.current.netCents : 0;
                const code = d.deptCode ?? 'UNASSIGNED';
                return (
                  <tr key={code}>
                    <td className="font-cond text-[17px] text-neutral-900">
                      {DEPT_LABEL[code] ?? code}
                      {d.deptCode === null ? <Tag tone="watch" className="ms-2">NO RULE</Tag> : null}
                    </td>
                    <td className="font-cond text-[17px] text-neutral-900">
                      <Num>{fmtMoney(d.netCents)}</Num>
                    </td>
                    <td className="text-neutral-500"><Num>{fmtMoney(d.grossCents)}</Num></td>
                    <td className="text-neutral-500"><Num>{fmtNumber(d.impressions)}</Num></td>
                    <td className="text-neutral-500"><Num>{fmtMoney(d.ecpmCents)}</Num></td>
                    <td>
                      <span className="flex items-center gap-2">
                        <span className="hud-gauge w-20">
                          <span
                            className="block h-full bg-accent"
                            style={{ width: `${Math.round(share * 100)}%` }}
                          />
                        </span>
                        <Num className="text-neutral-500">{(share * 100).toFixed(1)}%</Num>
                      </span>
                    </td>
                    <td className="whitespace-normal text-[12px] text-neutral-500">
                      {d.categories
                        .sort((a, b) => b.netCents - a.netCents)
                        .map((c) => CATEGORY_LABEL[c.category] ?? c.category)
                        .join(' · ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </HudCard>

      <HudCard id="mapping" className="p-0">
        <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
          <HudCardHeader title="Source-to-department mapping" index="F03" />
          <Tag tone="watch">MOVING TO CLICKUP LISTS</Tag>
        </div>
        <p className="px-[18px] pb-3 text-[13px] leading-[1.5] text-neutral-700">
          Departments are being switched to the eleven ClickUp lists. Until the ClickUp sync is
          connected, revenue still classifies against the proposal below, and anything matching no
          rule shows as UNASSIGNED rather than being folded into a department.
        </p>
        <table className="cockpit-table">
          <thead>
            <tr>
              <th>Business line</th>
              <th>Category</th>
              <th>Department</th>
              <th className="whitespace-normal">Rationale</th>
            </tr>
          </thead>
          <tbody>
            {DEFAULT_DEPT_MAPPING.map((rule) => (
              <tr key={`${rule.businessLine}-${rule.category}`}>
                <td>{rule.businessLine === 'trading' ? 'Trading Desk' : 'Managed Publishers'}</td>
                <td>{CATEGORY_LABEL[rule.category] ?? rule.category}</td>
                <td className="font-cond text-[17px] text-neutral-900">{DEPT_LABEL[rule.deptCode]}</td>
                <td className="whitespace-normal text-neutral-500">{rule.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-divider px-[18px] py-3 font-semi text-[11px] tracking-[0.1em] text-neutral-500">
          NO DATA SOURCE YET: {UNMAPPED_DEPTS.map((d) => DEPT_LABEL[d]).join(' · ')}
        </p>
      </HudCard>
    </div>
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
