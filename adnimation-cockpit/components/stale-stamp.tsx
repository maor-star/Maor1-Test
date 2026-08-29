import { fmtTime } from '@/lib/utils';
import { INTEGRATION_STALE_HOURS, isStale } from '@/lib/integrations/staleness';
import { Num } from '@/components/num';

/**
 * Stale data is labelled, never hidden. Every strip reading from a synced
 * source stamps when that data last landed, and says so plainly once the sync
 * has been failing longer than the threshold that raises INTEGRATION_FAILURE.
 */
export function StaleStamp({ at }: { at: Date | null }) {
  if (!at) {
    return (
      <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">NO DATA YET</span>
    );
  }

  const stale = isStale(at);
  return (
    <span
      className={`font-semi text-[10px] tracking-[0.14em] ${stale ? 'text-sev-warning' : 'text-neutral-500'}`}
    >
      SYNCED <Num>{fmtTime(at)}</Num>
      {stale ? (
        <span className="ms-1">
          · STALE &gt;<Num>{INTEGRATION_STALE_HOURS}</Num>H
        </span>
      ) : null}
    </span>
  );
}
