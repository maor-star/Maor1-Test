import { Led } from './card';
import { Num } from '@/components/num';
import { fmtTime, todayInTz } from '@/lib/utils';

/**
 * The top bar from the design handoff: accent rule + kicker, the large
 * condensed title, and the live status cluster.
 */
export function PageHeader({
  kicker,
  title,
  action,
}: {
  kicker: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-divider pb-[18px]">
      <div>
        <div className="flex items-center gap-[10px] hud-kicker">
          <span className="inline-block h-px w-[22px] bg-accent" />
          {kicker}
        </div>
        <h1 className="hud-title mt-2 text-[44px] text-neutral-900">{title}</h1>
      </div>

      <div className="flex items-center gap-[14px] font-semi text-[10px] tracking-[0.16em] text-neutral-500">
        <span className="inline-flex items-center gap-[7px] text-accent-300">
          <Led className="h-[6px] w-[6px]" />
          LIVE
        </span>
        <span>
          <Num>{todayInTz()}</Num>
        </span>
        <span>
          <Num>{fmtTime(new Date())}</Num> IST
        </span>
        {action}
      </div>
    </header>
  );
}
