import { Num } from '@/components/num';
import { cn } from '@/lib/utils';
import type { Delta } from '@/lib/revenue/summary';

/**
 * A percentage change. A missing comparison renders as "—", never as 0% —
 * "no data" and "no change" are different facts.
 */
export function DeltaPct({ delta, label }: { delta: Delta; label?: string }) {
  if (delta.pct === null) {
    return <span className="text-2xs text-muted-foreground">{label ? `${label} ` : ''}—</span>;
  }
  const up = delta.pct >= 0;
  return (
    <span
      className={cn(
        'font-cond text-[15px] leading-none',
        Math.abs(delta.pct) < 0.02
          ? 'text-muted-foreground'
          : up
            ? 'text-sev-ok'
            : 'text-sev-critical',
      )}
    >
      {label ? `${label} ` : ''}
      <Num>
        {up ? '+' : ''}
        {(delta.pct * 100).toFixed(1)}%
      </Num>
    </span>
  );
}
