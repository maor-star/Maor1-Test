'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clickUpStatusesAction, setClickUpStatusAction } from '@/app/actions/clickup-tasks';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';

/**
 * Changing a mirrored task's status without leaving the cockpit.
 *
 * The options come from the task's own ClickUp list, fetched on first use:
 * every list in the workspace defines its own statuses, and offering a
 * hardcoded set would fail on most of them. Closing removes the row from the
 * cockpit, because the mirror holds open work only — so the button says so.
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
      if (result.ok) router.refresh();
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
      <span className="font-semi text-[10px] tracking-[0.12em] text-neutral-500">
        NO STATUSES FROM CLICKUP
      </span>
    );
  }

  const closing = options.filter((o) => ['complete', 'closed', 'done'].includes(o.toLowerCase()));

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
        className="h-7 text-[12px]"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>

      {closing.length > 0 ? (
        <Button
          type="button"
          size="xs"
          disabled={pending}
          title="Closes it in ClickUp and removes it from the cockpit, which carries open work only"
          onClick={() => move(closing[0]!)}
        >
          {pending ? '…' : 'CLOSE'}
        </Button>
      ) : null}

      {error ? <span className="text-2xs text-destructive">{error}</span> : null}
    </div>
  );
}
