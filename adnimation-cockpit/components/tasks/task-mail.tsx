'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNowStrict } from 'date-fns';
import { dismissMailAction, readMailAction } from '@/app/actions/task-mail';
import type { MailLink, MailMessage } from '@/lib/tasks/mail-links';
import { fmtDateTime } from '@/lib/utils';
import { Num } from '@/components/num';

/**
 * The emails this task turned out to be about — and what they said.
 *
 * A job matches every open task against the mirrored mailbox every thirty
 * minutes and copies the threads it links in. A link on its own was a second
 * journey: he is reading a task, and finding out what the mail actually said
 * meant opening Gmail, finding his place and coming back. Clicking a subject
 * here opens the conversation in place.
 *
 * The messages are fetched when he opens one, not carried with the row: a
 * board of forty tasks would otherwise ship a hundred emails to the browser to
 * show two of them.
 *
 * Each link says WHY it is here. A matcher that hangs a wrong conversation off
 * a task and does not explain itself is one he stops reading; the reasons are
 * what make a wrong match a thing he dismisses in one click.
 */
export function TaskMail({
  taskId,
  items,
  compact = false,
  canRead = true,
}: {
  taskId: string;
  items: MailLink[];
  /** On a board row: two lines and no heading. */
  compact?: boolean;
  /**
   * Whether the viewer may read the mail itself. His mailbox is not part of
   * what a guest on the tasks board is granted — they see that a task has
   * email on it and cannot open it. Enforced again in the action.
   */
  canRead?: boolean;
}) {
  const [gone, setGone] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<Record<string, MailMessage[]>>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const showing = items.filter((m) => !gone.includes(m.threadId));
  if (showing.length === 0) return null;

  const drop = (threadId: string) => {
    // Off the screen at once: waiting for the round trip to remove a wrong
    // match makes the click feel like it did not register.
    setGone((held) => [...held, threadId]);
    if (open === threadId) setOpen(null);
    const data = new FormData();
    data.set('taskId', taskId);
    data.set('threadId', threadId);
    startTransition(async () => {
      const result = await dismissMailAction(data);
      if (!result.ok) setGone((held) => held.filter((t) => t !== threadId));
      else router.refresh();
    });
  };

  const toggle = (threadId: string) => {
    if (open === threadId) {
      setOpen(null);
      return;
    }
    setOpen(threadId);
    setError(null);
    if (read[threadId]) return;
    setLoading(true);
    readMailAction(taskId, threadId)
      .then((r) => {
        if (r.ok) setRead((held) => ({ ...held, [threadId]: r.messages }));
        else setError(r.error);
      })
      .catch(() => setError('Could not open it'))
      .finally(() => setLoading(false));
  };

  const rows = compact ? showing.slice(0, 2) : showing;

  return (
    <div className={compact ? 'mt-1 space-y-0.5' : 'space-y-1'}>
      {!compact ? (
        <p className="hud-label text-[10.5px] text-muted">
          From the mailbox · <Num>{showing.length}</Num>
        </p>
      ) : null}
      <ul className="space-y-0.5">
        {rows.map((m) => (
          <li key={m.threadId}>
            <div className="flex items-baseline gap-1.5 text-[12px]">
              <span aria-hidden className="text-muted">✉</span>

              {/* The subject opens the conversation here; the arrow is the way
                  out to Gmail, for replying. */}
              {canRead && m.messages > 0 ? (
                <button
                  type="button"
                  onClick={() => toggle(m.threadId)}
                  aria-expanded={open === m.threadId}
                  className="min-w-0 flex-1 truncate text-start text-info hover:underline"
                  title={`${m.subject}\nMatched because it ${m.reasons.join(' · ')}`}
                >
                  {m.subject}
                </button>
              ) : (
                <span
                  className="min-w-0 flex-1 truncate text-ink"
                  title={`${m.subject}\nMatched because it ${m.reasons.join(' · ')}`}
                >
                  {m.subject}
                </span>
              )}

              {m.counterpart ? (
                <span className="shrink-0 truncate text-[11px] text-muted">{m.counterpart}</span>
              ) : null}
              {m.lastMessageAt ? (
                <span className="shrink-0 text-[11px] text-muted">
                  {formatDistanceToNowStrict(new Date(m.lastMessageAt), { addSuffix: true })}
                </span>
              ) : null}
              {!compact ? (
                <span className="shrink-0 text-[11px] text-muted">{m.reasons.join(' · ')}</span>
              ) : null}

              <a
                href={m.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 px-1 text-[11px] text-muted hover:text-info"
                title="Open it in Gmail, to reply"
              >
                ↗
              </a>
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
            </div>

            {open === m.threadId ? (
              <div className="mt-1 space-y-1.5 rounded-[8px] border border-line bg-neutral-50 p-2">
                {loading && !read[m.threadId] ? (
                  <p className="text-[12px] text-muted">Opening it…</p>
                ) : error ? (
                  <p className="text-[12px] text-neg">{error}</p>
                ) : (
                  (read[m.threadId] ?? []).map((msg) => (
                    <article key={msg.id} className="border-b border-line pb-1.5 last:border-b-0 last:pb-0">
                      <p className="text-[11px] text-muted">
                        <span className={msg.fromMe ? 'font-semibold text-ink' : 'font-semibold'}>
                          {msg.fromMe ? 'You' : (msg.fromName ?? msg.fromEmail ?? 'Unknown')}
                        </span>
                        {msg.sentAt ? (
                          <>
                            {' · '}
                            <Num>{fmtDateTime(msg.sentAt)}</Num>
                          </>
                        ) : null}
                        {msg.hasFiles ? ' · has files' : ''}
                      </p>
                      {/* The mail as it was written — wrapped, never rendered:
                          this is somebody else's text and it is not markup. */}
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-neutral-800">
                        {msg.body}
                      </p>
                      {msg.truncated ? (
                        <p className="mt-0.5 text-[11px] text-muted">
                          Cut here —{' '}
                          <a href={m.url} target="_blank" rel="noreferrer" className="hover:underline">
                            the rest is in Gmail ↗
                          </a>
                        </p>
                      ) : null}
                    </article>
                  ))
                )}
                {!loading && !error && (read[m.threadId] ?? []).length === 0 ? (
                  <p className="text-[12px] text-muted">
                    Not copied in yet — the sweep fetches it within half an hour.
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {compact && showing.length > rows.length ? (
        <p className="text-[11px] text-muted">
          +<Num>{showing.length - rows.length}</Num> more in the task
        </p>
      ) : null}
    </div>
  );
}
