import { fmtMoney, fmtNumber } from '@/lib/utils';
import { SearchBox } from '@/components/hud/search-box';
import {
  SEAT_REVENUE_TARGET_CENTS, STATUS_LABEL, SUPPLY_SPEND_FLOOR_CENTS, type Seat,
} from '@/lib/seats/service';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';

const STATUS_TONE = {
  on_target: 'ok',
  building: 'watch',
  below: 'warning',
  dormant: 'outline',
} as const;

/**
 * The seat list. A wide table on a desktop and a stack of cards on a phone —
 * the same numbers either way, because the CEO reads this on both and a table
 * squeezed onto 380px is a table nobody reads.
 */
export function SeatTable({
  seats,
  side,
  index,
  total,
}: {
  seats: Seat[];
  side: 'demand' | 'supply';
  index: string;
  /** How many there are before the search narrowed them. */
  total?: number;
}) {
  return (
    <HudCard className="gap-0 p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 p-[18px] pb-3">
        <HudCardHeader
          title={side === 'demand' ? 'Demand seats' : 'Supply seats'}
          index={index}
          action={
            <div className="flex flex-wrap items-center gap-3">
              <SearchBox placeholder="Find a seat" />
              <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                {total !== undefined && total !== seats.length ? (
                  <>
                    <Num>{seats.length}</Num> OF <Num>{total}</Num> ·{' '}
                  </>
                ) : null}
                TARGET <Num>{fmtMoney(SEAT_REVENUE_TARGET_CENTS)}</Num>/DAY
                {side === 'supply' ? (
                  <>
                    {' '}· SPEND FLOOR <Num>{fmtMoney(SUPPLY_SPEND_FLOOR_CENTS)}</Num>/day
                  </>
                ) : null}
              </span>
            </div>
          }
        />
      </div>

      {/* Phone: one card per seat. */}
      <ul className="lg:hidden">
        {seats.map((s) => (
          <li key={`m:${s.seat}`} className="border-t border-line px-[18px] py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-cond text-[16px] text-neutral-900">{s.seat}</p>
                <p className="hud-label mt-0.5 text-[11px]">{s.company}</p>
              </div>
              <Tag tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Tag>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <Cell label="REV / DAY" value={fmtMoney(s.revPerDayCents)} />
              <Cell label="SPEND / DAY" value={fmtMoney(s.costPerDayCents)} />
              <Cell label="PROFIT / DAY" value={fmtMoney(s.profitPerDayCents)} />
            </div>

            <div className="mt-2">
              <HealthBar seat={s} />
            </div>
            <p className="mt-1 font-semi text-[11.5px] text-neutral-500">{s.because}</p>
          </li>
        ))}
      </ul>

      {/* Desktop: the full table. */}
      <div className="hidden min-w-0 overflow-x-auto lg:block">
        <table className="cockpit-table">
          <thead>
            <tr>
              <th className="w-[24%]">Seat</th>
              <th>Rev / day</th>
              <th>Spend / day</th>
              <th>Profit / day</th>
              <th>Margin</th>
              <th>vs target</th>
              <th>Days live</th>
              <th>Impressions</th>
              <th className="text-end">Health</th>
            </tr>
          </thead>
          <tbody>
            {seats.map((s) => (
              <tr key={s.seat}>
                <td className="whitespace-normal">
                  <span className="font-cond text-[15px] text-neutral-900">{s.seat}</span>
                  <p className="hud-label mt-0.5 text-[11px]">
                    {s.company}
                    {s.endpoints > 1 ? (
                      <>
                        {' '}· <Num>{s.endpoints}</Num> Endpoints
                      </>
                    ) : null}
                  </p>
                </td>
                <td className="font-cond text-[16px] text-neutral-900">
                  <Num>{fmtMoney(s.revPerDayCents)}</Num>
                </td>
                <td className={s.clearsSpendFloor === false ? 'text-sev-warning' : 'text-neutral-500'}>
                  <Num>{fmtMoney(s.costPerDayCents)}</Num>
                </td>
                <td className="text-neutral-500"><Num>{fmtMoney(s.profitPerDayCents)}</Num></td>
                <td className="text-neutral-500">
                  <Num>{s.marginPct === null ? '—' : `${(s.marginPct * 100).toFixed(0)}%`}</Num>
                </td>
                <td>
                  <span className="flex items-center gap-2">
                    <span className="hud-gauge w-16">
                      <span
                        className="block h-full rounded-full bg-info"
                        style={{ width: `${Math.max(1, Math.min(100, s.targetRatio * 100))}%` }}
                      />
                    </span>
                    <Num className="text-neutral-500">{(s.targetRatio * 100).toFixed(1)}%</Num>
                  </span>
                </td>
                <td className="text-neutral-500">
                  <Num>{s.activeDays}</Num>
                </td>
                <td className="text-neutral-500"><Num>{fmtNumber(s.impressions)}</Num></td>
                <td className="text-end">
                  <span className="inline-flex items-center gap-2">
                    <Tag tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Tag>
                    <span className="font-cond text-[14px] text-neutral-700">
                      <Num>{s.health}</Num>
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </HudCard>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="hud-label text-[11px]">{label}</span>
      <p className="font-cond text-[16px] leading-none text-neutral-900">
        <Num>{value}</Num>
      </p>
    </div>
  );
}

function HealthBar({ seat }: { seat: Seat }) {
  const tone =
    seat.health >= 70 ? 'bg-accent' : seat.health >= 45 ? 'bg-accent-500' : seat.health >= 25 ? 'bg-sev-warning' : 'bg-sev-critical';
  return (
    <span className="flex items-center gap-2">
      <span className="hud-gauge flex-1">
        <span className={`block h-full ${tone}`} style={{ width: `${Math.max(2, seat.health)}%` }} />
      </span>
      <span className="font-cond text-[13px] text-neutral-600">
        <Num>{seat.health}</Num>/100
      </span>
    </span>
  );
}
