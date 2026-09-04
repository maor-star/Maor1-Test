import { fmtMoney } from '@/lib/utils';
import { SEAT_REVENUE_TARGET_CENTS, type Seat } from '@/lib/seats/service';
import { Num } from '@/components/num';

/**
 * The seat map — every seat as one tile, sized by what it moves and coloured by
 * health.
 *
 * A table answers "what is each seat doing"; this answers "where is the money,
 * and which of it is in trouble", in one look. Tiles are laid out largest
 * first, so the eye lands on the seats that matter before the long tail.
 *
 * Built with CSS grid rather than a charting library: the shapes are
 * rectangles, and a 60KB dependency to draw rectangles is not a trade worth
 * making on a page that has to load fast on a phone.
 */

/** Health bands, matched to the design system's severity colours. */
function band(seat: Seat): { bg: string; text: string; label: string } {
  if (seat.status === 'dormant') {
    return { bg: 'bg-neutral-300', text: 'text-neutral-700', label: 'DORMANT' };
  }
  if (seat.health >= 70) return { bg: 'bg-accent', text: 'text-white', label: 'HEALTHY' };
  if (seat.health >= 45) return { bg: 'bg-accent-500/70', text: 'text-white', label: 'STEADY' };
  if (seat.health >= 25) return { bg: 'bg-sev-warning/80', text: 'text-white', label: 'WATCH' };
  return { bg: 'bg-sev-critical/85', text: 'text-white', label: 'ACTION' };
}

/**
 * Tile size, in grid columns. Proportional area would make the long tail
 * invisible, so the scale is compressed: the largest seat is 6 columns wide,
 * the smallest still 1 — every seat stays clickable and readable.
 */
function span(seat: Seat, largest: number): number {
  if (largest <= 0) return 1;
  const share = seat.revenueCents / largest;
  if (share >= 0.6) return 6;
  if (share >= 0.3) return 4;
  if (share >= 0.12) return 3;
  if (share >= 0.04) return 2;
  return 1;
}

export function SeatMap({ seats, side }: { seats: Seat[]; side: 'demand' | 'supply' }) {
  if (seats.length === 0) {
    return (
      <p className="font-semi text-[12px] text-neutral-500">
        No {side} seats in the window.
      </p>
    );
  }

  const largest = seats[0]?.revenueCents ?? 0;

  return (
    <div className="space-y-3">
      <div className="grid auto-rows-[76px] grid-cols-6 gap-[3px] sm:grid-cols-8 lg:grid-cols-12">
        {seats.map((s) => {
          const b = band(s);
          const cols = span(s, largest);
          return (
            <div
              key={`${s.side}:${s.seat}`}
              title={`${s.seat} — ${fmtMoney(s.revPerDayCents)}/day · health ${s.health}/100 · ${s.because}`}
              className={`${b.bg} ${b.text} flex min-w-0 flex-col justify-between overflow-hidden p-2`}
              style={{ gridColumn: `span ${cols} / span ${cols}` }}
            >
              <span className="truncate font-semi text-[11.5px] leading-tight tracking-[0.06em]">
                {s.seat}
              </span>
              <span className="truncate font-cond text-[15px] leading-none">
                <Num>{fmtMoney(s.revPerDayCents)}</Num>
                <span className="ms-1 text-[11px] opacity-80">/day</span>
              </span>
            </div>
          );
        })}
      </div>

      <TargetRail seats={seats} />
      <Legend />
    </div>
  );
}

/**
 * One bar per seat against the $15k/day target, so the distance to target is
 * visible as a length rather than read as a percentage.
 */
function TargetRail({ seats }: { seats: Seat[] }) {
  const shown = seats.slice(0, 14);

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="hud-label text-[11px]">Against the $15K / day target</span>
        <span className="font-semi text-[11px] tracking-[0.12em] text-neutral-500">
          Top <Num>{shown.length}</Num> By revenue
        </span>
      </div>
      {shown.map((s) => {
        const width = Math.max(0.6, Math.min(100, s.targetRatio * 100));
        const b = band(s);
        return (
          <div key={`rail:${s.seat}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <span className="grid grid-cols-[minmax(88px,132px)_minmax(0,1fr)] items-center gap-2">
              <span className="truncate font-semi text-[11.5px] tracking-[0.06em] text-neutral-600">
                {s.seat}
              </span>
              <span className="relative block h-[9px] bg-neutral-200">
                <span className={`block h-full ${b.bg}`} style={{ width: `${width}%` }} />
              </span>
            </span>
            <span className="w-[70px] text-end font-cond text-[12px] text-neutral-600">
              <Num>{fmtMoney(s.revPerDayCents)}</Num>
            </span>
          </div>
        );
      })}
      <p className="font-semi text-[11px] tracking-[0.1em] text-neutral-500">
        FULL BAR = <Num>{fmtMoney(SEAT_REVENUE_TARGET_CENTS)}</Num> Per day
      </p>
    </div>
  );
}

function Legend() {
  const items = [
    { cls: 'bg-accent', label: 'HEALTHY 70+' },
    { cls: 'bg-accent-500/70', label: 'STEADY 45+' },
    { cls: 'bg-sev-warning/80', label: 'WATCH 25+' },
    { cls: 'bg-sev-critical/85', label: 'ACTION < 25' },
    { cls: 'bg-neutral-300', label: 'DORMANT' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-[6px]">
          <span className={`inline-block h-[9px] w-[14px] ${i.cls}`} />
          <span className="font-semi text-[11px] tracking-[0.12em] text-neutral-500">{i.label}</span>
        </span>
      ))}
    </div>
  );
}
