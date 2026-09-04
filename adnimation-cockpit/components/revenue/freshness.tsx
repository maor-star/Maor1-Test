import { Num } from '@/components/num';

/**
 * How old the P&L is, stated rather than implied.
 *
 * The figures used to be compiled into the build, which meant they aged
 * silently: nothing on screen distinguished a number pulled an hour ago from
 * one pulled last week, so the only way to discover it was stale was to
 * disbelieve it. The rule in CLAUDE.md §7 is that stale data is labelled, never
 * hidden — this is that label, and it turns amber once the sync has plainly
 * stopped running.
 */
export function Freshness({
  pulledAt,
  lastCompleteDay,
  partialDay,
  live,
  now = new Date(),
}: {
  pulledAt: string;
  lastCompleteDay: string;
  partialDay: string;
  /** False while the built-in fixture is standing in for the synced table. */
  live?: boolean;
  now?: Date;
}) {
  const pulled = new Date(pulledAt);
  const ageHours = Number.isNaN(pulled.getTime())
    ? null
    : Math.max(0, Math.round((now.getTime() - pulled.getTime()) / 3_600_000));

  // The sync runs every three hours, so anything past eight has missed at
  // least two runs and is no longer just "a bit behind".
  const stale = ageHours !== null && ageHours >= 8;

  return (
    <p
      className={`font-semi text-[11.5px] tracking-[0.12em] ${
        stale ? 'text-sev-warning' : 'text-neutral-500'
      }`}
    >
      SOURCE: AD OPS ARCHITECT (LOVABLE) · READ-ONLY ·{' '}
      {ageHours === null ? (
        <>Pulled <Num>{pulledAt}</Num></>
      ) : ageHours < 1 ? (
        'UPDATED IN THE LAST HOUR'
      ) : (
        <>
          Updated <Num>{ageHours}h</Num> Ago
        </>
      )}
      {live === false ? ' · FROM THE BUILT-IN SNAPSHOT, NOT A LIVE SYNC' : ''}
      {stale ? ' · THE SYNC HAS NOT RUN' : ''} · Last complete day{' '}
      <Num>{lastCompleteDay}</Num> · <Num>{partialDay}</Num> Is still partial
    </p>
  );
}
