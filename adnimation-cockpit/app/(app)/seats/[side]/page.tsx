import { notFound } from 'next/navigation';
import {
  SEAT_REVENUE_TARGET_CENTS, SUPPLY_SPEND_FLOOR_CENTS, gapToTargetCents, loadSeats,
  type SeatSide,
} from '@/lib/seats/service';
import { fmtMoney } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { SeatMap } from '@/components/seats/seat-map';
import { SeatTable } from '@/components/seats/seat-table';

export const dynamic = 'force-dynamic';

const SIDES: Record<SeatSide, { kicker: string; title: string; blurb: string }> = {
  demand: {
    kicker: 'DEMAND / 11',
    title: 'Demand seats',
    blurb:
      'Every DSP buying through the exchange, measured against the $15,000/day revenue target. Health combines how close a seat is to target, how much of the month it actually traded, and the margin it holds.',
  },
  supply: {
    kicker: 'SUPPLY / 12',
    title: 'Supply seats',
    blurb:
      'Every SSP endpoint sending us inventory. A supply seat also has to clear the $2,000/day spend floor — below it the seat is a candidate for closing, and its health is capped however good its margin looks.',
  },
};

export function generateStaticParams() {
  return [{ side: 'demand' }, { side: 'supply' }];
}

export default async function SeatsPage({ params }: { params: Promise<{ side: string }> }) {
  const { side } = await params;
  if (side !== 'demand' && side !== 'supply') notFound();

  const view = await loadSeats(side);
  const meta = SIDES[side];
  const gap = gapToTargetCents(view.seats);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={meta.kicker}
        title={meta.title}
        action={
          <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
            <Num>{view.windowDays}</Num> DAYS TO <Num>{view.lastDay}</Num> · SOURCE: AD OPS
            ARCHITECT (READ-ONLY)
          </span>
        }
      />

      <HudCard>
        <HudCardHeader
          title="Where the seats stand"
          index={side === 'demand' ? 'D01' : 'U01'}
          action={
            <Tag tone={view.totals.onTarget > 0 ? 'ok' : 'warning'}>
              <Num>{view.totals.onTarget}</Num>
              <span className="ms-1">OF {view.totals.seats} ON TARGET</span>
            </Tag>
          }
        />

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 xl:flex xl:flex-wrap xl:items-end xl:gap-x-10">
          <Figure label="REVENUE / DAY" value={fmtMoney(view.totals.revPerDayCents)} big />
          <Figure label="SPEND / DAY" value={fmtMoney(view.totals.costPerDayCents)} />
          <Figure label="PROFIT / DAY" value={fmtMoney(view.totals.profitPerDayCents)} />
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
          GAP TO TARGET IS WHAT EVERY SEAT WOULD HAVE TO ADD TO REACH{' '}
          <Num>{fmtMoney(SEAT_REVENUE_TARGET_CENTS)}</Num> A DAY EACH — ALL{' '}
          <Num>{view.totals.seats}</Num> OF THEM.
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

      <SeatTable seats={view.seats} side={side} index={side === 'demand' ? 'D03' : 'U03'} />

      <p className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
        SOURCE: AD OPS ARCHITECT (LOVABLE) · READ-ONLY · PULLED <Num>{view.pulledAt}</Num> ·
        SPEND ON A SUPPLY SEAT IS WHAT IS PAID OUT TO THAT PARTNER
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
