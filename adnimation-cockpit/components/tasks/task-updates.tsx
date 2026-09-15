'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNowStrict } from 'date-fns';
import { addCommentAction } from '@/app/actions/tasks';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { authorLabel, type TaskUpdate } from '@/lib/tasks/update-shape';

/**
 * What has happened on a task, and room to add to it.
 *
 * The updates existed, on the task's own page, which is the one place he is
 * not when he thinks of one. Writing a line cost a trip off the board and
 * back, and reading one meant opening a task to discover nothing had happened
 * — so the board never showed them and he never wrote them.
 *
 * Newest first here, which is the opposite of the task page. A page is a
 * history and reads forwards; a panel is a glance and the last thing said is
 * the thing worth seeing.
 */
export function TaskUpdates({
  taskId,
  updates,
  total,
  people,
  canNotify,
}: {
  taskId: string;
  /** Newest first, already capped by the query. */
  updates: TaskUpdate[];
  total: number;
  people: { email: string; name: string }[];
  /** Whether there is anybody else to tell. */
  canNotify: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [notify, setNotify] = useState(false);
  const router = useRouter();

  const send = () => {
    const text = body.trim();
    if (!text) return;
    const data = new FormData();
    data.set('taskId', taskId);
    data.set('body', text);
    if (notify) data.set('notify', 'true');
    setError(null);
    setSaid(null);
    startTransition(async () => {
      const result = await addCommentAction(data);
      if (!result.ok) {
        setError(result.error ?? 'That did not save');
        return;
      }
      setBody('');
      setNotify(false);
      setSaid(result.notice ?? 'Saved.');
      router.refresh();
    });
  };

  const hidden = total - updates.length;

  return (
    <div className="space-y-2">
      <span className="hud-label block text-[10.5px]">
        Updates{total > 0 ? ` · ${total}` : ''}
      </span>

      {updates.length > 0 ? (
        <ul className="space-y-1.5">
          {updates.map((u) => (
            <li key={u.id} className="rounded-[8px] bg-surface px-2.5 py-1.5 text-[13.5px]">
              <span className="mb-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
                <span className="font-semibold text-ink">{authorLabel(u.author, people)}</span>
                <span>{formatDistanceToNowStrict(u.createdAt, { addSuffix: true })}</span>
              </span>
              {/* Kept as written — a note with line breaks in it was written
                  that way for a reason. */}
              <span className="block whitespace-pre-wrap text-ink">{u.body}</span>
            </li>
          ))}
          {hidden > 0 ? (
            <li className="px-1 text-[11.5px] text-muted">
              and <span className="font-semibold">{hidden}</span> older — the task&apos;s own page
              has all of them
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="px-1 text-[12.5px] text-muted">Nothing written on this one yet.</p>
      )}

      <Textarea
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What happened?"
        aria-label="Write an update"
        onKeyDown={(e) => {
          // Enter is a newline in a note; the shortcut sends.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        {canNotify ? (
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            Also send it to whoever is on this task
          </label>
        ) : (
          <span className="text-[11.5px] text-muted">Nobody else is on this one.</span>
        )}

        <Button type="button" size="xs" disabled={pending || body.trim() === ''} onClick={send}>
          {pending ? 'SAVING…' : notify ? 'SAVE & SEND' : 'SAVE'}
        </Button>
      </div>

      {error ? <p className="text-[12.5px] text-neg">{error}</p> : null}
      {said ? <p className="text-[12.5px] text-pos">{said}</p> : null}
    </div>
  );
}
