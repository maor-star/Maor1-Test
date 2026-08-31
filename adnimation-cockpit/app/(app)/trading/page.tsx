import Link from 'next/link';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import {
  DEAD_REVENUE_PER_M_CENTS, TRADING_PERIODS, TRADING_PERIOD_LABEL, loadTrading,
  type TradingPeriod,
} from '@/lib/trading/service';
import { fmtMoney, fmtNumber } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Trading — the exchange desk.
 *
 * Four questions, in the order a trader asks them: what did the desk make, which
 * bundles made it, who was on each side of those trades and through which
 * endpoint, and — the expensive one — which supply is pouring requests into
 * demand that never buys.
 */
export default async function TradingPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const sp = await searchParams;
  const period: TradingPeriod = TRADING_PERIODS.includes(sp.period as TradingPeriod)
    ? (sp.period as TradingPeriod)
    : 'YESTERDAY';

  const view = await loadTrading(period);
  const topBundles = view.bundles.slice(0, 20);
  const maxBundleProfit = topBundles[0]?.profitCents ?? 1;
  const wasteRows = view.waste.rows.slice(0, 24);
  const maxWasteRequests = wasteRows[0]?.requests ?? 1;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="EXCHANGE / 13"
        title="TRADING"
        action={
          <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
            <Num>{view.from}</Num> → <Num>{view.to}</Num>
          </span>
        }
      />

      <nav className="flex border border-divider">
        {TRADING_PERIODS.map((p) => (
          <Link
            key={p}
            href={`/trading?period=${p}`}
            className={`px-3 py-1 font-semi text-[11px] uppercase tracking-[0.16em] ${
              p === period ? 'bg-accent text-ground' : 'text-neutral-500 hover:text-accent'
            }`}
          >
            {TRADING_PERIOD_LABEL[p]}
          </Link>
        ))}
      </nav>

      <HudCard>
        <HudCardHeader
          title="The desk"
          index="T01"
          action={
            <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
              <Num>{view.days}</Num> {view.days === 1 ? 'DAY' : 'DAYS'}
            </span>
          }
        />
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          <Figure label="PROFIT" value={fmtMoney(view.totals.profitCents)} big />
          <Figure label="REVENUE" value={fmtMoney(view.totals.revenueCents)} big />
          <Figure label="COST" value={fmtMoney(view.totals.costCents)} />
          <Figure label="MARGIN" value={`${view.totals.marginPct.toFixed(1)}%`} />
          <Figure label="IMPRESSIONS" value={fmtNumber(view.totals.impressions)} />
          <Figure label="REQUESTS" value={fmtNumber(view.totals.requests)} />
        </div>
        <p className="border-t border-divider pt-3 font-semi text-[10px] tracking-[0.12em] text-neutral-500">
          TOTALS FROM THE EXCHANGE&apos;S OWN DAILY ACCOUNTING. THE RANKINGS BELOW ARE THE TOP OF
          THE BUNDLE LEDGER, NOT ALL OF IT.
        </p>
      </HudCard>

      <HudCard className="gap-0 p-0">
        <div className="p-[18px] pb-3">
          <HudCardHeader
            title="Bundles that made the money"
            index="T02"
            action={
              <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                SOLD BY · BOUGHT BY · THROUGH
              </span>
            }
          />
        </div>

        {topBundles.length === 0 ? (
          <p className="border-t border-divider px-[18px] py-4 font-semi text-[12px] text-neutral-500">
            No bundle cleared the floor in this window.
          </p>
        ) : (
          <ul>
            {topBundles.map((b, i) => (
              <li key={b.bundle} className="border-t border-divider px-[18px] py-3">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-cond text-[10px] tracking-[0.16em] text-accent-700">
                        <Num>{String(i + 1).padStart(2, '0')}</Num>
                      </span>
                      <p className="break-all font-cond text-[17px] leading-none text-neutral-900">
                        {b.bundle}
                      </p>
                      <Tag tone={b.marginPct >= 30 ? 'ok' : b.marginPct >= 20 ? 'outline' : 'warning'}>
                        {b.marginPct.toFixed(0)}% MARGIN
                      </Tag>
                    </div>

                    <p className="mt-1.5 break-words text-[13px] text-neutral-700">
                      <span className="hud-label me-1.5 text-[9px]">SOLD BY</span>
                      {b.sellers.map((s) => s.name).join(', ')}
                      <span className="hud-label mx-1.5 text-[9px]">BOUGHT BY</span>
                      {b.buyers.map((s) => s.name).join(', ')}
                    </p>

                    <p className="hud-label mt-1 whitespace-normal break-words text-[9px]">
                      THROUGH {b.topRoute.sellerEndpoint} → {b.topRoute.buyerEndpoint}
                      {b.routes > 1 ? ` · +${b.routes - 1} MORE ROUTE${b.routes > 2 ? 'S' : ''}` : ''}
                    </p>
                  </div>

                  <div className="flex w-full flex-wrap items-start gap-x-5 gap-y-2 sm:w-auto sm:shrink-0">
                    <Cell label="PROFIT" value={fmtMoney(b.profitCents)} strong />
                    <Cell label="REVENUE" value={fmtMoney(b.revenueCents)} />
                    <Cell label="IMPRESSIONS" value={fmtNumber(b.impressions)} />
                  </div>
                </div>

                <div className="mt-2 h-[3px] w-full bg-neutral-200">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${Math.max(2, (b.profitCents / maxBundleProfit) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </HudCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <SideCard title="Who bought" index="T03" rows={view.buyers} />
        <SideCard title="Who sold" index="T04" rows={view.sellers} />
      </div>

      <HudCard className="gap-0 p-0">
        <div className="p-[18px] pb-3">
          <HudCardHeader
            title="Routes"
            index="T05"
            action={
              <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                SUPPLY ENDPOINT → DEMAND ENDPOINT
              </span>
            }
          />
        </div>
        <ul>
          {view.routes.slice(0, 12).map((r) => (
            <li
              key={`${r.sellerEndpoint}-${r.buyerEndpoint}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-divider px-[18px] py-2.5"
            >
              <div className="min-w-0">
                <p className="break-words text-[13px] text-neutral-800">
                  {r.sellerEndpoint} <span className="text-accent-700">→</span> {r.buyerEndpoint}
                </p>
                <p className="hud-label mt-0.5 whitespace-normal break-words text-[9px]">
                  {r.sellerCompany} → {r.buyerCompany} · <Num>{fmtNumber(r.bundles)}</Num> BUNDLES
                </p>
              </div>
              <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 sm:w-auto sm:shrink-0">
                <Cell label="MARGIN" value={`${r.marginPct.toFixed(0)}%`} />
                <Cell label="PROFIT" value={fmtMoney(r.profitCents)} strong />
              </div>
            </li>
          ))}
        </ul>
      </HudCard>

      <HudCard className="gap-0 p-0">
        <div className="p-[18px] pb-3">
          <HudCardHeader
            title="Requests going nowhere"
            index="T06"
            action={
              <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                <Num>{view.waste.date}</Num>
              </span>
            }
          />
          <p className="mt-2 text-[13px] text-neutral-600">
            Supply sending impressions to demand that does not buy them. The bar is the request
            volume; the figure beside it is what that volume earned per million requests. Anything
            under <Num>{fmtMoney(DEAD_REVENUE_PER_M_CENTS)}</Num> per million is flagged — the
            demand endpoint is taking the traffic and paying nothing for it.
          </p>
          <p className="hud-label mt-2 whitespace-normal text-[9px]">
            <Num>{fmtNumber(view.waste.deadRequests)}</Num> OF{' '}
            <Num>{fmtNumber(view.waste.totalRequests)}</Num> REQUESTS ON FLAGGED PATHS ·{' '}
            <Num>
              {((view.waste.deadRequests / Math.max(1, view.waste.totalRequests)) * 100).toFixed(0)}
              %
            </Num>
          </p>
        </div>

        <ul>
          {wasteRows.map((w) => (
            <li
              key={`${w.sellerCompany}-${w.buyerCompany}`}
              className="border-t border-divider px-[18px] py-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="break-words text-[13px] text-neutral-800">
                    {w.sellerCompany} <span className="text-accent-700">→</span> {w.buyerCompany}
                  </p>
                  {w.dead ? <Tag tone="critical">NOT BUYING</Tag> : null}
                </div>
                <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 sm:w-auto sm:shrink-0">
                  <Cell label="PER MILLION REQ" value={fmtMoney(w.revenuePerMillionCents)} />
                  <Cell label="REQUESTS" value={fmtNumber(w.requests)} />
                  <Cell label="REVENUE" value={fmtMoney(w.revenueCents)} strong />
                </div>
              </div>
              <div className="mt-1.5 h-[3px] w-full bg-neutral-200">
                <div
                  className={`h-full ${w.dead ? 'bg-sev-critical' : 'bg-accent'}`}
                  style={{ width: `${Math.max(2, (w.requests / maxWasteRequests) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </HudCard>

      <p className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
        SOURCE: <span className="normal-case tracking-normal">{view.meta.source}</span> · PULLED{' '}
        <Num>{view.meta.pulledAt.slice(0, 16).replace('T', ' ')}</Num> UTC
      </p>
    </div>
  );
}

function SideCard({
  title,
  index,
  rows,
}: {
  title: string;
  index: string;
  rows: { name: string; revenueCents: number; profitCents: number; marginPct: number }[];
}) {
  const max = rows[0]?.profitCents ?? 1;

  return (
    <HudCard className="gap-0 p-0">
      <div className="p-[18px] pb-3">
        <HudCardHeader title={title} index={index} />
      </div>
      <ul>
        {rows.slice(0, 10).map((r) => (
          <li key={r.name} className="border-t border-divider px-[18px] py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="min-w-0 break-words font-cond text-[15px] text-neutral-900">{r.name}</p>
              <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 sm:w-auto sm:shrink-0">
                <Cell label="MARGIN" value={`${r.marginPct.toFixed(0)}%`} />
                <Cell label="PROFIT" value={fmtMoney(r.profitCents)} strong />
              </div>
            </div>
            <div className="mt-1.5 h-[3px] w-full bg-neutral-200">
              <div
                className="h-full bg-accent"
                style={{ width: `${Math.max(2, (r.profitCents / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </HudCard>
  );
}

function Cell({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="text-end">
      <span className="hud-label block text-[9px]">{label}</span>
      <span
        className={`font-cond leading-none ${
          strong ? 'text-[19px] text-neutral-900' : 'text-[16px] text-neutral-700'
        }`}
      >
        <Num>{value}</Num>
      </span>
    </div>
  );
}

function Figure({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <span className="hud-label block text-[9px]">{label}</span>
      <span
        className={`font-cond leading-none text-neutral-900 ${big ? 'text-[30px]' : 'text-[22px]'}`}
      >
        <Num>{value}</Num>
      </span>
    </div>
  );
}
