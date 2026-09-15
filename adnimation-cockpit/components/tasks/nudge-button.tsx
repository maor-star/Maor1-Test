'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNowStrict } from 'date-fns';
import { nudgeTaskAction } from '@/app/actions/task-nudge';

/**
 * "מה קורה עם זה?" — the chase, as one button.
 *
 * Everything here is work he handed to somebody, and the follow-up is the same
 * six words every time. Doing it by hand means finding the person in Slack,
 * finding the task title and pasting a link, which is enough friction that it
 * does not happen and the task just goes quiet.
 *
 * It says when he last asked, because the question straight after pressing it
 * is whether he already did — without that it gets pressed twice on the same
 * Tuesday and the person gets the same six words from him again.
 */
export function NudgeButton({
  taskId,
  people,
  lastAsked,
  timesAsked = 0,
  compact = false,
}: {
  taskId: string;
  /** Who it will reach — the button refuses rather than sending to nobody. */
  people: { id: string; name: string }[];
  lastAsked: Date | null;
  /** How many times he has already chased this one. */
  timesAsked?: number;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const router = useRouter();

  /*
   * It asks twice, because the second half of this button is a Slack message
   * to a colleague and there is no taking one back. One press arms it and says
   * who it is about to reach; the next sends. It disarms itself after a few
   * seconds so an armed button he walked away from is not left waiting for a
   * stray click.
   */
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const send = () => {
    setArmed(false);
    const data = new FormData();
    data.set('taskId', taskId);
    setSaid(null);
    setProblem(null);
    startTransition(async () => {
      const result = await nudgeTaskAction(data);
      if (!result.ok) {
        setProblem(result.error ?? 'Slack would not take it');
        return;
      }
      setSaid(`Asked ${result.sent?.map((s) => s.name).join(', ')}`);
      if (result.error) setProblem(result.error);
      // The refresh is what turns the button into ASK AGAIN and bumps the
      // count, so the row tells him what he just did without him re-reading it.
      router.refresh();
    });
  };

  const ago = lastAsked ? formatDistanceToNowStrict(lastAsked, { addSuffix: true }) : null;
  const disabled = pending || people.length === 0;

  /*
   * Asking again is the normal case, not an edge case — most chases are the
   * second or third one. The button used to read ASK whether or not he had
   * already sent it, which left the row looking finished and the repeat
   * looking unavailable. Saying ASK AGAIN is the whole feature.
   */
  const again = lastAsked !== null;
  const idleLabel = again ? (compact ? 'שוב?' : 'ASK AGAIN') : compact ? 'מה קורה?' : 'ASK';

  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={() => (armed ? send() : setArmed(true))}
        disabled={disabled}
        title={
          people.length === 0
            ? 'Nobody is on this task yet'
            : `Slack ${people.map((p) => p.name).join(', ')} — "מה קורה עם זה?" — in your name${
                ago ? `. Last asked ${ago}` : ''
              }${timesAsked > 1 ? `, ${timesAsked} times in all.` : ago ? '.' : ''}`
        }
        className={`rounded-[5px] border px-1.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] ${
          disabled
            ? 'cursor-not-allowed border-line text-muted opacity-50'
            : armed
              ? 'border-accent bg-accent text-white'
              : 'border-line text-info hover:bg-info/10'
        }`}
      >
        {pending ? '…' : armed ? 'SEND' : idleLabel}
      </button>
      {armed && !pending ? (
        <span className="text-[10px] text-accent">
          → {people.map((p) => p.name).join(', ')}
        </span>
      ) : null}
      {said ? <span className="text-[10px] text-pos">{said}</span> : null}
      {problem ? (
        <span className="max-w-[10rem] text-[10px] text-neg" title={problem}>
          {problem.length > 40 ? `${problem.slice(0, 40)}…` : problem}
        </span>
      ) : null}

      {/*
        When he last asked, and how often. Three chases on one task is a fact
        about the task rather than about the button, and it belongs where he
        is deciding whether to send a fourth.
      */}
      {!said && ago ? (
        <span className={`text-[10px] ${timesAsked > 2 ? 'font-semibold text-warn' : 'text-muted'}`}>
          {ago}
          {timesAsked > 1 ? ` · ${timesAsked}×` : ''}
        </span>
      ) : null}
    </span>
  );
}
