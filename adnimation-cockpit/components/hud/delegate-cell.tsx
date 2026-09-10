'use client';

import Link from 'next/link';
import { DelegateButton } from '@/components/tasks/delegate-button';
import type { DelegationMark } from '@/lib/delegation/for-many';

/**
 * Whether this row has been handed over, and to whom.
 *
 * He asked for it in one line: "so I know if I passed it on". A row that had
 * been delegated on Tuesday looked exactly like one nobody had touched, so the
 * only way to find out was to leave the screen and read the delegations list.
 *
 * Three states, and they are genuinely three rather than two:
 *   · nobody has it — so the cell offers to hand it over
 *   · it is with someone and they have not answered
 *   · it is with someone and they have
 *
 * The middle and the last are the ones that matter. "Sent" and "answered" look
 * the same on a tracker that only records who it went to, and the difference
 * between them is the whole reason he asks.
 */

/** How long before silence is worth looking at. Matches the stale check. */
const QUIET_DAYS = 3;

export function DelegateCell({
  mark,
  entityId,
  entityType,
  title,
  people,
  now = new Date(),
}: {
  mark: DelegationMark | undefined;
  entityId: string;
  entityType: 'task' | 'contract' | 'deal';
  /** What the hand-over is about, for the message that goes out. */
  title: string;
  people: { id: string; label: string }[];
  now?: Date;
}) {
  if (!mark) {
    return (
      <span className="flex justify-center">
        <DelegateButton
          sourceEntityId={entityId}
          sourceEntityType={entityType}
          defaultTitle={title}
          people={people}
        />
      </span>
    );
  }

  const answered = mark.repliedAt !== null;
  const days = Math.floor((now.getTime() - mark.delegatedAt.getTime()) / 86_400_000);
  const quiet = !answered && days >= QUIET_DAYS;

  /*
   * Green once they answered, amber while it is still out, red once it has
   * gone quiet — the same three meanings the group bars use, so the colour
   * says the same thing on every screen.
   */
  const tone = answered
    ? { dot: '#16a34a', label: 'text-[#157a45]' }
    : quiet
      ? { dot: '#dc2626', label: 'text-neg' }
      : { dot: '#f97316', label: 'text-ink' };

  const said = answered
    ? 'They answered'
    : quiet
      ? `No answer for ${days} days`
      : days === 0
        ? 'Sent today'
        : `Sent ${days} ${days === 1 ? 'day' : 'days'} ago`;

  const inner = (
    <span className="flex min-w-0 items-center justify-center gap-1.5" title={said}>
      <span
        aria-hidden
        className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ background: tone.dot }}
      />
      <span className={`truncate text-[11.5px] font-semibold ${tone.label}`}>{mark.personName}</span>
    </span>
  );

  // The Slack message is the proof it went out, so the name is a way back to
  // it. Without a permalink there is nothing to link to and it stays plain.
  return mark.slackMessageUrl ? (
    <Link href={mark.slackMessageUrl} target="_blank" rel="noreferrer" className="hover:underline">
      {inner}
    </Link>
  ) : (
    inner
  );
}
