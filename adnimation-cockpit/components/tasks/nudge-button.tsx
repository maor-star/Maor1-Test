'use client';

import { useState, useTransition } from 'react';
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
  compact = false,
}: {
  taskId: string;
  /** Who it will reach — the button refuses rather than sending to nobody. */
  people: { id: string; name: string }[];
  lastAsked: Date | null;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const router = useRouter();

  const send = () => {
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
      router.refresh();
    });
  };

  const ago = lastAsked ? formatDistanceToNowStrict(lastAsked, { addSuffix: true }) : null;
  const disabled = pending || people.length === 0;

  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={send}
        disabled={disabled}
        title={
          people.length === 0
            ? 'Nobody is on this task yet'
            : `Slack ${people.map((p) => p.name).join(', ')} — "מה קורה עם זה?" — in your name${
                ago ? `. Last asked ${ago}.` : ''
              }`
        }
        className={`rounded-[5px] border border-line px-1.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] ${
          disabled ? 'cursor-not-allowed text-muted opacity-50' : 'text-info hover:bg-info/10'
        }`}
      >
        {pending ? '…' : compact ? 'מה קורה?' : 'ASK'}
      </button>
      {said ? <span className="text-[10px] text-pos">{said}</span> : null}
      {problem ? (
        <span className="max-w-[10rem] text-[10px] text-neg" title={problem}>
          {problem.length > 40 ? `${problem.slice(0, 40)}…` : problem}
        </span>
      ) : !said && ago ? (
        <span className="text-[10px] text-muted">{ago}</span>
      ) : null}
    </span>
  );
}
