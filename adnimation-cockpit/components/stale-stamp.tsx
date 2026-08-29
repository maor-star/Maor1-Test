import { fmtTime } from '@/lib/utils';
import { INTEGRATION_STALE_HOURS, isStale } from '@/lib/integrations/staleness';
import { Num } from '@/components/num';

/**
 * §7 — stale data is labelled, never hidden. Every strip reading from a synced
 * source stamps when that data last landed, and says so plainly once the sync
 * has been failing longer than the threshold that raises INTEGRATION_FAILURE.
 */
export function StaleStamp({ at, label = 'נתונים מ' }: { at: Date | null; label?: string }) {
  if (!at) {
    return <span className="text-2xs text-muted-foreground">אין נתונים עדיין</span>;
  }

  const stale = isStale(at);
  return (
    <span className={stale ? 'text-2xs text-sev-warning' : 'text-2xs text-muted-foreground'}>
      {label}־<Num>{fmtTime(at)}</Num>
      {stale ? (
        <span className="ms-1">
          · הסנכרון תקוע מעל <Num>{INTEGRATION_STALE_HOURS}</Num> שעות
        </span>
      ) : null}
    </span>
  );
}
