import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  SEAT_REVENUE_TARGET_CENTS, SUPPLY_SPEND_FLOOR_CENTS, availableSeatPeriods, gapToTargetCents,
  loadSeats, type SeatSide,
} from '@/lib/seats/service';
import { PERIOD_LABEL, PERIOD_TAB, isPeriod, type Period } from '@/lib/revenue/periods';
import { fmtMoney } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { SeatMap } from '@/components/seats/seat-map';
import { SeatTable } from '@/components/seats/seat-table';
import { filterByQuery } from '@/lib/search';

export const dynamic = 'force-dynamic';

const SIDES: Record<SeatSide, { kicker: string; title: string; blurb: string }> = {
  demand: {
    kicker: 'DEMAND / 08',
    title: 'Demand seats',
    blurb:
      'Every DSP buying through the exchange, measured against the $15,000/day revenue target. Health combines how close a seat is to target, how much of the window it actually traded, and the margin it holds.',
  },
  supply: {
    kicker: 'SUPPLY / 09',
    title: 'Supply seats',
    blurb:
      'Every SSP endpoint sending us inventory. A supply seat also has to clear the $2,000/day spend floor — below it the seat is a candidate for closing, and its health is capped however good its margin looks.',
  },
};

export default async function SeatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ side: string }>;
  searchParams: Promise<{ period?: string; q?: string }>;
}) {
  const { side } = await params;
  if (side !== 'demand' && side !== 'supply') notFound();

  const sp = await searchParams;
  const available = await availableSeatPeriods();
  const requested: Period = isPeriod(sp.period) ? sp.period : '30D';
  const period = available.includes(requested) ? requested : (available[0] ?? '30D');

  const view = await loadSeats(side, period);
  const meta = SIDES[side];
  const gap = gapToTargetCents(view.seats);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={meta.kicker}
        title={meta.title}
        action={
          <nav className="flex flex-wrap border border-divider">
            {available.map((p) => (
              <Link
                key={p}
                href={`/seats/${side}?period=${p}`}
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

      {view.empty ? (
        <HudCard>
          <HudCardHeader title={PERIOD_LABEL[period]} index="S00" action={<Tag tone="watch">NO DATA</Tag>} />
          <p className="font-semi text-[12px] leading-relaxed text-neutral-500">
            The exchange economics tables start on <Num>{view.meta.coverageFrom}</Num>, so this
            window has no rows. Pick a shorter window rather than reading an empty one as a
            collapse.
          </p>
        </HudCard>
      ) : (
        <>
          <HudCard>
            <HudCardHeader
              title={`Where the seats stand · ${PERIOD_LABEL[period]}`}
              index={side === 'demand' ? 'D01' : 'U01'}
              action={
                <Tag tone={view.totals.onTarget > 0 ? 'ok' : 'warning'}>
                  <Num>{view.totals.onTarget}</Num>
                  <span className="ms-1">/ {view.totals.seats} ON TARGET</span>
                </Tag>
              }
            />

            <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 xl:flex xl:flex-wrap xl:items-end xl:gap-x-10">
              <Figure label="REVENUE / DAY" value={fmtMoney(view.totals.revPerDayCents)} big />
              <Figure label="SPEND / DAY" value={fmtMoney(view.totals.costPerDayCents)} />
              <Figure label="PROFIT / DAY" value={fmtMoney(view.totals.profitPerDayCents)} />
              <Figure label={`REVENUE / ${PERIOD_TAB[period]}`} value={fmtMoney(view.totals.revenueCents)} />
              <Figure label="SEATS" value={String(view.totals.seats)} />
              <Figure label="DORMANT" value={String(view.totals.dormant)} />
              {side === 'supply' ? (
                <Figure
                  label={`OVER ${fmtMoney(SUPPLY_SPEND_FLOOR_CENTS)} SPEND`}
                  value={`${view.totals.clearingFloor} / ${view.totals.seats}`}
                />
              ) : null}
              <Figure label="GAP TO TARGET / DAY" value={fmtMoney(gap)} />
            </div>

            <p className="font-semi text-[11px] leading-relaxed text-neutral-500">{meta.blurb}</p>
            <p className="font-semi text-[10px] leading-relaxed tracking-[0.06em] text-neutral-500">
              PER-DAY FIGURES DIVIDE THE WINDOW&rsquo;S TOTAL BY ITS{' '}
              <Num>{view.windowDays}</Num> DAYS, SO EVERY WINDOW IS COMPARABLE AGAINST THE SAME{' '}
              <Num>{fmtMoney(SEAT_REVENUE_TARGET_CENTS)}</Num> A DAY TARGET.
            </p>
          </HudCard>

          <HudCard>
            <HudCardHeader
              title="Seat map"
              index={side === 'demand' ? 'D02' : 'U02'}
              action={
                <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
                  SIZED BY REVENUE · COLOURED BY HEALTH
                </span>
              }
            />
            <SeatMap seats={view.seats} side={side} />
          </HudCard>

          <SeatTable
            seats={filterByQuery(view.seats, sp.q, (seat) => [seat.seat, seat.company])}
            total={view.seats.length}
            side={side}
            index={side === 'demand' ? 'D03' : 'U03'}
          />
        </>
      )}

      <p className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
        SOURCE: AD OPS ARCHITECT (LOVABLE) · READ-ONLY · PULLED <Num>{view.meta.pulledAt}</Num> ·
        LAST COMPLETE DAY <Num>{view.meta.lastCompleteDay}</Num> · SPEND ON A SUPPLY SEAT IS WHAT IS
        PAID OUT TO THAT PARTNER
      </p>
    </div>
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
