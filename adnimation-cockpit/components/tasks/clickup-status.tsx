'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useUndo } from '@/components/ui/undo-bar';
import { clickUpStatusesAction, setClickUpStatusAction } from '@/app/actions/clickup-tasks';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';

/**
 * Changing a mirrored task's status without leaving the cockpit.
 *
 * The options come from the task's own ClickUp list, fetched on first use:
 * every list in the workspace defines its own statuses, and offering a
 * hardcoded set would fail on most of them.
 *
 * Closing no longer removes the row: it is marked done and kept, which is what
 * makes reopening possible — pick an open status here and it goes back, in
 * ClickUp and here. A task closed by mistake used to simply vanish.
 */
export function ClickUpStatus({
  taskId,
  status,
  compact = false,
}: {
  taskId: string;
  status: string;
  compact?: boolean;
}) {
  const [options, setOptions] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const undo = useUndo();

  useEffect(() => {
    if (options !== null || !loading) return;
    let cancelled = false;
    clickUpStatusesAction(taskId)
      .then((s) => {
        if (!cancelled) setOptions(s);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, options, taskId]);

  const move = (next: string) => {
    const data = new FormData();
    data.set('taskId', taskId);
    data.set('status', next);
    startTransition(async () => {
      const result = await setClickUpStatusAction(data);
      setError(result.ok ? null : (result.error ?? 'Could not change the status'));
      if (result.ok) {
        undo.offer();
        router.refresh();
      }
    });
  };

  if (options === null) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={loading}
          onClick={() => setLoading(true)}
        >
          {loading ? 'LOADING…' : compact ? 'STATUS' : 'CHANGE STATUS'}
        </Button>
        {error ? <span className="text-2xs text-destructive">{error}</span> : null}
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
        No statuses from ClickUp
      </span>
    );
  }

  const isClosed = (o: string) => ['complete', 'closed', 'done'].includes(o.toLowerCase());
  const closing = options.filter(isClosed);
  const reopening = options.filter((o) => !isClosed(o));

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <label className="sr-only" htmlFor={`status-${taskId}`}>
        ClickUp status
      </label>
      <Select
        id={`status-${taskId}`}
        defaultValue={status}
        disabled={pending}
        onChange={(e) => move(e.target.value)}
        className="h-9 text-[13.5px]"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>

      {/*
        Reopening is picking an open status above — but a done task shows no
        obvious way back, so the first open status the list offers gets a
        button of its own.
      */}
      {status === 'done' && reopening.length > 0 ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={pending}
          title="Puts it back to the first open status this ClickUp list has"
          onClick={() => move(reopening[0]!)}
        >
          {pending ? '…' : 'REOPEN'}
        </Button>
      ) : null}

      {status !== 'done' && closing.length > 0 ? (
        <Button
          type="button"
          size="xs"
          disabled={pending}
          title="Closes it in ClickUp. It stays here, marked done, so you can reopen it"
          onClick={() => move(closing[0]!)}
        >
          {pending ? '…' : 'CLOSE'}
        </Button>
      ) : null}

      {error ? <span className="text-2xs text-destructive">{error}</span> : null}
    </div>
  );
}
