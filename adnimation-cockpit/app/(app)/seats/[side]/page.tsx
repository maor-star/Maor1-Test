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
          <nav className="segmented flex-wrap">
            {available.map((p) => (
              <Link
                key={p}
                href={`/seats/${side}?period=${p}`}
                aria-current={p === period ? 'page' : undefined}
              >
                {PERIOD_TAB[p]}
              </Link>
            ))}
          </nav>
        }
      />

      {view.empty ? (
        <HudCard>
          <HudCardHeader title={PERIOD_LABEL[period]} index="S00" action={<Tag tone="watch">No data</Tag>} />
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
            <p className="font-semi text-[11.5px] leading-relaxed tracking-[0.06em] text-neutral-500">
              PER-DAY FIGURES DIVIDE THE WINDOW&rsquo;S TOTAL BY ITS{' '}
              <Num>{view.windowDays}</Num> days, so every window is comparable against the same{' '}
              <Num>{fmtMoney(SEAT_REVENUE_TARGET_CENTS)}</Num> A day target.
            </p>
          </HudCard>

          <HudCard>
            <HudCardHeader
              title="Seat map"
              index={side === 'demand' ? 'D02' : 'U02'}
              action={
                <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                  Sized by revenue · coloured by health
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

      <p className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
        Source: Ad Ops Architect (Lovable) · read-only · pulled <Num>{view.meta.pulledAt}</Num> ·
        Last complete day <Num>{view.meta.lastCompleteDay}</Num> · Spend on a supply seat is what is
        paid out to that partner
      </p>
    </div>
  );
}

function Figure({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="hud-label text-[11px]">{label}</p>
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
