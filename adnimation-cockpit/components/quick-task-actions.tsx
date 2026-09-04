'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useUndo } from '@/components/ui/undo-bar';
import {
  archiveTaskAction, completeTaskAction, snoozeTaskAction, updateTaskAction,
} from '@/app/actions/tasks';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { STATUS_LABEL, TASK_STATUSES } from '@/lib/tasks/types';

/**
 * §7 — every list row carries its actions inline, no modal chain.
 *
 * A mirrored ClickUp row gets its status control instead of these: that write
 * goes to ClickUp first (see app/actions/clickup-tasks.ts), so it cannot share
 * a button with a task the cockpit owns outright.
 */
export function QuickTaskActions({
  taskId,
  isMine,
  status = 'open',
}: {
  taskId: string;
  isMine: boolean;
  status?: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const undo = useUndo();

  if (!isMine) return null;

  const run = (action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, extra?: Record<string, string>) => {
    const fd = new FormData();
    fd.set('id', taskId);
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok && result.error) window.alert(result.error);
      if (result.ok) undo.offer();
      router.refresh();
    });
  };

  const done = status === 'done';

  return (
    <span className="inline-flex flex-nowrap items-center gap-1 whitespace-nowrap">
      {/*
        The status, on the row. Closing and reopening are the two things he
        does most from a list he is working through, and walking into the task
        to do either of them loses his place in it.
      */}
      <label className="sr-only" htmlFor={`row-status-${taskId}`}>
        Status
      </label>
      <Select
        id={`row-status-${taskId}`}
        value={status}
        disabled={pending}
        className="h-[30px] w-auto text-[13px]"
        onChange={(e) => run(updateTaskAction, { status: e.target.value })}
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
        ))}
      </Select>

      {done ? (
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() => run(updateTaskAction, { status: 'open' })}
          title="Put it back on the list"
        >
          Reopen
        </Button>
      ) : (
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() => run(completeTaskAction)}
          title="Close this task"
        >
          Done
        </Button>
      )}
      <Button
        size="xs"
        variant="ghost"
        disabled={pending}
        onClick={() => run(snoozeTaskAction, { days: '7' })}
        title="Snooze a week — counts toward the Zombie rule"
      >
        Snooze
      </Button>
      {/*
        Removing a task he never wanted. It archives rather than deletes —
        nothing in this system deletes (CLAUDE.md §2) — but from every screen
        it is gone, which is what "delete" means to the person clicking it.
      */}
      <Button
        size="xs"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!window.confirm('Remove this task? It leaves every view.')) return;
          run(archiveTaskAction);
        }}
        title="Remove it from every view"
      >
        Delete
      </Button>
    </span>
  );
}
