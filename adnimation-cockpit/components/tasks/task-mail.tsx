'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNowStrict } from 'date-fns';
import { dismissMailAction } from '@/app/actions/task-mail';
import type { MailLink } from '@/lib/tasks/mail-links';

/**
 * The emails this task turned out to be about.
 *
 * He asked for the tasks to fish the relevant mail out of the mailbox and keep
 * fishing, so a job matches every open task against the mirrored threads every
 * twenty minutes and these are what it found. Nothing here talks to Gmail —
 * the subject and the counterpart were written down when the link was made, so
 * a row still reads properly for a thread that has since rolled out of the
 * mirror's window.
 *
 * Each one says WHY it is here. A matcher that hangs a wrong conversation off a
 * task and does not explain itself is one he stops reading; the reasons are
 * what make a wrong match a thing he can dismiss in one click rather than a
 * mystery he has to open Gmail to resolve.
 */
export function TaskMail({
  taskId,
  items,
  compact = false,
}: {
  taskId: string;
  items: MailLink[];
  /** On a board row: two lines and no heading. */
  compact?: boolean;
}) {
  const [gone, setGone] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const showing = items.filter((m) => !gone.includes(m.threadId));
  if (showing.length === 0) return null;

  const drop = (threadId: string) => {
    // Off the screen at once: waiting for the round trip to remove a wrong
    // match makes the click feel like it did not register.
    setGone((held) => [...held, threadId]);
    const data = new FormData();
    data.set('taskId', taskId);
    data.set('threadId', threadId);
    startTransition(async () => {
      const result = await dismissMailAction(data);
      if (!result.ok) setGone((held) => held.filter((t) => t !== threadId));
      else router.refresh();
    });
  };

  const rows = compact ? showing.slice(0, 2) : showing;

  return (
    <div className={compact ? 'mt-1 space-y-0.5' : 'space-y-1'}>
      {!compact ? (
        <p className="hud-label text-[10.5px] text-muted">
          From the mailbox · {showing.length}
        </p>
      ) : null}
      <ul className="space-y-0.5">
        {rows.map((m) => (
          <li key={m.threadId} className="flex items-baseline gap-1.5 text-[12px]">
            <span aria-hidden className="text-muted">✉</span>
            <a
              href={m.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-info hover:underline"
              title={`${m.subject}${m.counterpart ? ` — ${m.counterpart}` : ''}\nMatched because it ${m.reasons.join(' · ')}`}
            >
              {m.subject}
            </a>
            {m.counterpart ? (
              <span className="shrink-0 truncate text-[11px] text-muted">{m.counterpart}</span>
            ) : null}
            {m.lastMessageAt ? (
              <span className="shrink-0 text-[11px] text-muted">
                {formatDistanceToNowStrict(new Date(m.lastMessageAt), { addSuffix: true })}
              </span>
            ) : null}
            {/* Why it is here, in the matcher's own words. */}
            {!compact ? (
              <span className="shrink-0 text-[11px] text-muted">{m.reasons.join(' · ')}</span>
            ) : null}
            <button
              type="button"
              onClick={() => drop(m.threadId)}
              disabled={pending}
              title="Not about this task. It will not come back."
              className="shrink-0 px-1 text-[12px] leading-none text-muted hover:text-neg disabled:opacity-40"
              aria-label={`Take "${m.subject}" off this task`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {compact && showing.length > rows.length ? (
        <p className="text-[11px] text-muted">+{showing.length - rows.length} more in the task</p>
      ) : null}
    </div>
  );
}
