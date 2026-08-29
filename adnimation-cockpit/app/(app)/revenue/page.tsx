import Link from 'next/link';
import { summariseAllPeriods, summariseCompany, LINE_NOTE } from '@/lib/revenue/company';
import { summariseForPeriod } from '@/lib/revenue/period-service';
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

const CUTS = ['line', 'category', 'window'] as const;
type Cut = (typeof CUTS)[number];

const CUT_LABEL: Record<Cut, string> = {
  line: 'BUSINESS LINE',
  category: 'DEMAND CATEGORY',
  window: 'TIME WINDOW',
};

/**
 * Revenue, reconciled to the source.
 *
 * Every figure is computed with the same expression the Ad Ops Architect
 * system's own reporting functions use, so this page and that app agree to the
 * cent — see lib/revenue/company.ts for what that reconciliation corrected.
 *
 * Profit is Adnimation's own money: what is left after the source fee, the
 * publisher rev share, the partner payout or the DSP cost, depending on the
 * line. Gross is what moved through. The two are never conflated.
 */
export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; cut?: string }>;
}) {
  const sp = await searchParams;
  const period: Period = isPeriod(sp.period) ? sp.period : '30D';
  const cut: Cut = CUTS.includes(sp.cut as Cut) ? (sp.cut as Cut) : 'line';

  const s = await summariseCompany(period);

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
                href={`/revenue?period=${p}&cut=${cut}`}
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
            <span className="flex flex-wrap items-center gap-2">
              {s.range.partial ? (
                <Tag tone="watch" title="The source is still receiving this day; it will keep rising">
                  PARTIAL DAY
                </Tag>
              ) : null}
              <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
                <Num>{s.range.current.from}</Num> — <Num>{s.range.current.to}</Num> ·{' '}
                <Num>{s.company.days}</Num> DAYS
              </span>
            </span>
          }
        />

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 xl:flex xl:flex-wrap xl:items-end xl:gap-x-10">
          <Figure label="PROFIT" value={fmtMoney(s.company.profitCents)} big />
          <Figure label="GROSS" value={fmtMoney(s.company.grossCents)} />
          <Figure
            label="MARGIN"
            value={s.company.marginPct === null ? '—' : `${(s.company.marginPct * 100).toFixed(1)}%`}
          />
          <Figure label="PROFIT / DAY" value={fmtMoney(s.company.dailyProfitCents)} />
          <Figure label="IMPRESSIONS" value={fmtNumber(s.company.impressions)} />

          <div>
            <p className="hud-label text-[9px]">{COMPARISON_LABEL[period].toUpperCase()}</p>
            <p className="mt-1">
              <DeltaPct delta={{ pct: s.deltaPct, absCents: null }} />
            </p>
            <p className="mt-1 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
              {s.previous.days > 0 ? (
                <>
                  WAS <Num>{fmtMoney(s.previous.profitCents)}</Num> OVER{' '}
                  <Num>{s.previous.days}</Num> DAYS
                </>
              ) : (
                'NO COMPARABLE PERIOD IN THE DATA'
              )}
            </p>
          </div>
        </div>

        <Sparkline
          values={s.series.map((d) => d.profitCents)}
          className="mt-1 h-14 w-full text-accent-500"
        />
        <div className="flex justify-between font-semi text-[10px] tracking-[0.12em] text-neutral-500">
          <Num>{s.range.current.from}</Num>
          <span>DAILY PROFIT</span>
          <Num>{s.range.current.to}</Num>
        </div>

        <p className="font-semi text-[10px] leading-relaxed tracking-[0.06em] text-neutral-500">
          PROFIT IS ADNIMATION&rsquo;S OWN MONEY — AFTER THE SOURCE FEE, THE PUBLISHER REV SHARE,
          THE PARTNER PAYOUT AND THE DSP COST. COMPUTED WITH THE SOURCE&rsquo;S OWN FORMULAS, SO
          THESE FIGURES MATCH THE AD OPS ARCHITECT APP.
        </p>
      </HudCard>

      <nav className="flex flex-wrap items-center gap-2">
        <span className="hud-label text-[9px]">BREAK DOWN BY</span>
        <span className="flex flex-wrap border border-divider">
          {CUTS.map((c) => (
            <Link
              key={c}
              href={`/revenue?period=${period}&cut=${c}`}
              className={`px-3 py-1 font-semi text-[10px] tracking-[0.14em] ${
                c === cut ? 'bg-accent text-ground' : 'text-neutral-500 hover:text-accent'
              }`}
            >
              {CUT_LABEL[c]}
            </Link>
          ))}
        </span>
      </nav>

      {cut === 'line' ? <ByLine summary={s} period={period} /> : null}
      {cut === 'category' ? <ByCategory period={period} /> : null}
      {cut === 'window' ? <ByWindow active={period} /> : null}

      <p className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
        SOURCE: AD OPS ARCHITECT (LOVABLE) · READ-ONLY · PULLED <Num>{s.pulledAt}</Num> · LAST
        COMPLETE DAY <Num>{s.lastCompleteDay}</Num> · TODAY <Num>{s.partialDay}</Num> IS PARTIAL
      </p>
    </div>
  );
}

/** Cut 1 — the four business lines that make up the company. */
function ByLine({
  summary,
  period,
}: {
  summary: Awaited<ReturnType<typeof summariseCompany>>;
  period: Period;
}) {
  return (
    <HudCard className="gap-0 p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title="By business line"
          index="F02"
          action={
            <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
              EACH LINE ON ITS OWN DEFINITION
            </span>
          }
        />
      </div>

      <ul className="lg:hidden">
        {summary.lines.map((l) => (
          <li key={`m:${l.line}`} className="border-t border-divider px-[18px] py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="font-cond text-[16px] text-neutral-900">{l.label}</p>
              <DeltaPct delta={{ pct: l.deltaPct, absCents: null }} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Cell label="PROFIT" value={fmtMoney(l.profitCents)} />
              <Cell label="GROSS" value={fmtMoney(l.grossCents)} />
              <Cell
                label="MARGIN"
                value={l.marginPct === null ? '—' : `${(l.marginPct * 100).toFixed(0)}%`}
              />
            </div>
            <p className="mt-1 font-semi text-[10px] leading-relaxed text-neutral-500">
              {LINE_NOTE[l.line]}
            </p>
          </li>
        ))}
      </ul>

      <div className="hidden min-w-0 overflow-x-auto lg:block">
        <table className="cockpit-table">
          <thead>
            <tr>
              <th className="w-[20%]">Line</th>
              <th>Profit</th>
              <th>Gross</th>
              <th>Paid out</th>
              <th>Margin</th>
              <th>Impressions</th>
              <th>Share of profit</th>
              <th className="text-end">{COMPARISON_LABEL[period]}</th>
            </tr>
          </thead>
          <tbody>
            {summary.lines.map((l) => (
              <tr key={l.line}>
                <td className="whitespace-normal">
                  <span className="font-cond text-[16px] text-neutral-900">{l.label}</span>
                  <p className="hud-label mt-0.5 whitespace-normal text-[9px] normal-case tracking-normal">
                    {LINE_NOTE[l.line]}
                  </p>
                </td>
                <td className="font-cond text-[17px] text-neutral-900">
                  <Num>{fmtMoney(l.profitCents)}</Num>
                </td>
                <td className="text-neutral-500"><Num>{fmtMoney(l.grossCents)}</Num></td>
                <td className="text-neutral-500"><Num>{fmtMoney(l.costCents)}</Num></td>
                <td className="text-neutral-500">
                  <Num>{l.marginPct === null ? '—' : `${(l.marginPct * 100).toFixed(1)}%`}</Num>
                </td>
                <td className="text-neutral-500"><Num>{fmtNumber(l.impressions)}</Num></td>
                <td>
                  <span className="flex items-center gap-2">
                    <span className="hud-gauge w-20">
                      <span
                        className="block h-full bg-accent"
                        style={{ width: `${Math.round(l.shareOfProfit * 100)}%` }}
                      />
                    </span>
                    <Num className="text-neutral-500">{(l.shareOfProfit * 100).toFixed(1)}%</Num>
                  </span>
                </td>
                <td className="text-end">
                  <DeltaPct delta={{ pct: l.deltaPct, absCents: null }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </HudCard>
  );
}

/**
 * Cut 2 — the publisher business by the demand category the source groups on.
 * Gross only: the rev share that turns gross into profit is applied per site,
 * not per category, so a per-category profit figure would be invented.
 */
async function ByCategory({ period }: { period: Period }) {
  const s = await summariseForPeriod(period);

  return (
    <HudCard className="gap-0 p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title="By demand category"
          index="F03"
          action={
            <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
              PUBLISHER BUSINESS · GROSS
            </span>
          }
        />
      </div>

      <div className="min-w-0 overflow-x-auto">
        <table className="cockpit-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Gross</th>
              <th>Impressions</th>
              <th>eCPM</th>
              <th>Share</th>
              <th className="text-end">{COMPARISON_LABEL[period]}</th>
            </tr>
          </thead>
          <tbody>
            {s.depts.map((d) => (
              <tr key={d.deptCode}>
                <td className="font-cond text-[16px] text-neutral-900">{d.label}</td>
                <td className="font-cond text-[16px] text-neutral-900">
                  <Num>{fmtMoney(d.grossCents)}</Num>
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

      <p className="border-t border-divider px-[18px] py-2 font-semi text-[10px] leading-relaxed tracking-[0.06em] text-neutral-500">
        GROSS ONLY. THE REV SHARE THAT TURNS GROSS INTO PROFIT IS SET PER SITE, NOT PER CATEGORY,
        SO A PER-CATEGORY PROFIT WOULD BE AN INVENTION RATHER THAN A MEASUREMENT.
      </p>
    </HudCard>
  );
}

/** Cut 3 — every window side by side. */
async function ByWindow({ active }: { active: Period }) {
  const all = await summariseAllPeriods(PERIODS);

  return (
    <HudCard className="gap-0 p-0">
      <div className="flex items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader title="Every window" index="F04" />
      </div>
      <div className="min-w-0 overflow-x-auto">
        <table className="cockpit-table">
          <thead>
            <tr>
              <th>Window</th>
              <th>Range</th>
              <th>Days</th>
              <th>Profit</th>
              <th>Gross</th>
              <th>Margin</th>
              <th>Profit / day</th>
              <th className="text-end">Change</th>
            </tr>
          </thead>
          <tbody>
            {all.map((p) => (
              <tr key={p.period} className={p.period === active ? 'bg-accent-100/40' : undefined}>
                <td className="font-cond text-[16px] text-neutral-900">
                  <Link href={`/revenue?period=${p.period}&cut=window`} className="hover:text-accent">
                    {PERIOD_LABEL[p.period]}
                  </Link>
                  {p.range.partial ? <Tag tone="watch" className="ms-2">PARTIAL</Tag> : null}
                </td>
                <td className="text-[11px] text-neutral-500">
                  <Num>{p.range.current.from}</Num> → <Num>{p.range.current.to}</Num>
                </td>
                <td className="text-neutral-500"><Num>{p.company.days}</Num></td>
                <td className="font-cond text-[17px] text-neutral-900">
                  <Num>{fmtMoney(p.company.profitCents)}</Num>
                </td>
                <td className="text-neutral-500"><Num>{fmtMoney(p.company.grossCents)}</Num></td>
                <td className="text-neutral-500">
                  <Num>
                    {p.company.marginPct === null ? '—' : `${(p.company.marginPct * 100).toFixed(1)}%`}
                  </Num>
                </td>
                <td className="text-neutral-500"><Num>{fmtMoney(p.company.dailyProfitCents)}</Num></td>
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
    <div className="min-w-0">
      <p className="hud-label text-[9px]">{label}</p>
      <p
        className={
          big
            ? 'hud-numeral mt-1 text-[32px] sm:text-[38px]'
            : 'mt-1 font-cond text-[20px] font-medium leading-none text-neutral-800 sm:text-[22px]'
        }
      >
        <Num>{value}</Num>
      </p>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="hud-label text-[9px]">{label}</span>
      <p className="font-cond text-[16px] leading-none text-neutral-900">
        <Num>{value}</Num>
      </p>
    </div>
  );
}
