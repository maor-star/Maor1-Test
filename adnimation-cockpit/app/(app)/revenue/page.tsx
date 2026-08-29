import Link from 'next/link';
import { loadRevenueView } from '@/lib/revenue/service';
import { DEPT_LABEL } from '@/lib/revenue/labels';
import { CATEGORY_LABEL } from '@/lib/revenue/types';
import { DEFAULT_DEPT_MAPPING, UNMAPPED_DEPTS } from '@/lib/revenue/mapping';
import { todayInTz, fmtMoney, fmtNumber } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { Sparkline } from '@/components/revenue/sparkline';
import { DeltaPct } from '@/components/revenue/delta';

export const dynamic = 'force-dynamic';

/** Spec 7.3 — the daily overview, with drill-down to demand category. */
export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ basis?: string; dept?: string }>;
}) {
  const sp = await searchParams;
  const basis = sp.basis === 'gross' ? 'gross' : 'net';
  const today = todayInTz();
  const { summary, date } = await loadRevenueView(today, basis);

  if (!summary || !date) {
    return (
      <div className="space-y-5">
        <PageHeader kicker="REVENUE / 02" title="Revenue" />
        <p className="font-semi text-[12px] text-neutral-500">No complete day of data yet.</p>
      </div>
    );
  }

  const focused = sp.dept
    ? summary.depts.find((d) => (d.deptCode ?? 'UNASSIGNED') === sp.dept)
    : null;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="REVENUE / 02"
        title="Revenue"
        action={
          <div className="flex border border-divider">
            {(['net', 'gross'] as const).map((b) => (
              <Link
                key={b}
                href={`/revenue?basis=${b}${sp.dept ? `&dept=${sp.dept}` : ''}`}
                className={`px-3 py-1 font-semi text-[11px] tracking-[0.16em] ${
                  b === basis ? 'bg-accent text-ground' : 'text-neutral-500 hover:text-accent'
                }`}
              >
                {b.toUpperCase()}
              </Link>
            ))}
          </div>
        }
      />

      <HudCard>
        <HudCardHeader
          title="Company total"
          index="F01"
          action={
            <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
              LAST FULL DAY <Num>{date}</Num> · SOURCE: AD OPS ARCHITECT (READ-ONLY)
            </span>
          }
        />

        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <Figure label="NET" value={fmtMoney(summary.totalNetCents)} big />
          <Figure label="GROSS" value={fmtMoney(summary.totalGrossCents)} />
          <Figure
            label="TAKE RATE"
            value={summary.takeRate === null ? '—' : `${(summary.takeRate * 100).toFixed(1)}%`}
          />
          <Figure label="IMPRESSIONS" value={fmtNumber(summary.totalImpressions)} />
          <Figure label="ECPM" value={fmtMoney(summary.ecpmCents)} />

          <div className="flex gap-6">
            <Labelled label="VS PREV DAY"><DeltaPct delta={summary.vsPrevDay} /></Labelled>
            <Labelled label="VS SAME DAY LAST WEEK"><DeltaPct delta={summary.vsSameDayLastWeek} /></Labelled>
            <Labelled label="VS 7-DAY AVG"><DeltaPct delta={summary.vsSevenDayAvg} /></Labelled>
          </div>
        </div>

        <Sparkline values={summary.spark} className="mt-1 h-12 w-full text-accent-500" />
      </HudCard>

      <HudCard className="p-0">
        <div className="min-w-0 overflow-x-auto">
          <table className="cockpit-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Net</th>
                <th>Gross</th>
                <th>Take rate</th>
                <th>Impressions</th>
                <th>eCPM</th>
                <th>vs prev day</th>
                <th>vs last week</th>
                <th>30-day trend</th>
              </tr>
            </thead>
            <tbody>
              {summary.depts.map((d) => {
                const code = d.deptCode ?? 'UNASSIGNED';
                return (
                  <tr key={code}>
                    <td>
                      <Link
                        href={`/revenue?basis=${basis}&dept=${code}`}
                        className="font-cond text-[17px] text-neutral-900 hover:text-accent"
                      >
                        {DEPT_LABEL[code] ?? code}
                      </Link>
                      {!d.mappingConfirmed ? (
                        <Tag tone="watch" className="ms-2">UNCONFIRMED</Tag>
                      ) : null}
                    </td>
                    <td className="font-cond text-[17px] text-neutral-900"><Num>{fmtMoney(d.netCents)}</Num></td>
                    <td className="text-neutral-500"><Num>{fmtMoney(d.grossCents)}</Num></td>
                    <td className="text-neutral-500">
                      <Num>{d.takeRate === null ? '—' : `${(d.takeRate * 100).toFixed(1)}%`}</Num>
                    </td>
                    <td className="text-neutral-500"><Num>{fmtNumber(d.impressions)}</Num></td>
                    <td className="text-neutral-500"><Num>{fmtMoney(d.ecpmCents)}</Num></td>
                    <td><DeltaPct delta={d.vsPrevDay} /></td>
                    <td><DeltaPct delta={d.vsSameDayLastWeek} /></td>
                    <td><Sparkline values={d.spark} className="h-6 w-28 text-accent-500/70" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </HudCard>

      {focused ? (
        <HudCard className="p-0">
          <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
            <HudCardHeader
              title={`Breakdown — ${DEPT_LABEL[focused.deptCode ?? 'UNASSIGNED']}`}
              index="F03"
            />
            <Link
              href={`/revenue?basis=${basis}`}
              className="font-semi text-[11px] tracking-[0.16em] text-accent-700 hover:text-accent"
            >
              CLEAR FILTER
            </Link>
          </div>
          <table className="cockpit-table">
            <thead>
              <tr>
                <th>Demand source</th>
                <th>Business line</th>
                <th>Net</th>
                <th>Gross</th>
              </tr>
            </thead>
            <tbody>
              {focused.categories.map((c) => (
                <tr key={`${c.businessLine}-${c.category}`}>
                  <td className="font-cond text-[17px] text-neutral-900">
                    {CATEGORY_LABEL[c.category] ?? c.category}
                  </td>
                  <td className="text-neutral-500">
                    {c.businessLine === 'trading' ? 'Trading Desk' : 'Managed Publishers'}
                  </td>
                  <td><Num>{fmtMoney(c.netCents)}</Num></td>
                  <td className="text-neutral-500"><Num>{fmtMoney(c.grossCents)}</Num></td>
                </tr>
              ))}
            </tbody>
          </table>
        </HudCard>
      ) : null}

      <HudCard id="mapping" className="p-0">
        <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
          <HudCardHeader title="Source-to-department mapping" index="F02" />
          {summary.mappingNeedsReview ? <Tag tone="watch">NEEDS SIGN-OFF</Tag> : null}
        </div>

        <p className="px-[18px] pb-3 text-[13px] leading-[1.5] text-neutral-700">
          The source distinguishes business line (Trading Desk vs. Managed Publishers) and demand
          category. It does not carry the eight business units from the spec, so the table below is a
          proposal awaiting sign-off — not a fact. Revenue matching no rule shows under UNASSIGNED
          rather than being folded into a department.
        </p>

        <table className="cockpit-table">
          <thead>
            <tr>
              <th>Business line</th>
              <th>Category</th>
              <th>Proposed department</th>
              <th className="whitespace-normal">Rationale</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {DEFAULT_DEPT_MAPPING.map((rule) => (
              <tr key={`${rule.businessLine}-${rule.category}`}>
                <td>{rule.businessLine === 'trading' ? 'Trading Desk' : 'Managed Publishers'}</td>
                <td>{CATEGORY_LABEL[rule.category] ?? rule.category}</td>
                <td className="font-cond text-[17px] text-neutral-900">{DEPT_LABEL[rule.deptCode]}</td>
                <td className="whitespace-normal text-neutral-500">{rule.why}</td>
                <td>
                  <Tag tone={rule.confirmed ? 'accent' : 'watch'}>
                    {rule.confirmed ? 'CONFIRMED' : 'PROPOSED'}
                  </Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="border-t border-divider px-[18px] py-3 font-semi text-[11px] tracking-[0.1em] text-neutral-500">
          UNITS WITH NO DATA SOURCE YET: {UNMAPPED_DEPTS.map((d) => DEPT_LABEL[d]).join(' · ')}
        </p>
      </HudCard>
    </div>
  );
}

function Figure({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <p className="hud-label text-[9px]">{label}</p>
      <p className={big ? 'hud-numeral mt-1 text-[38px]' : 'mt-1 font-cond text-[22px] font-medium leading-none text-neutral-800'}>
        <Num>{value}</Num>
      </p>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="hud-label text-[9px]">{label}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}
