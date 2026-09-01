'use client';

import { useState } from 'react';
import { taskForEditAction } from '@/app/actions/tasks';
import { Button } from '@/components/ui/button';
import { EditTaskForm } from '@/components/tasks/edit-task-form';

/**
 * The whole task, from wherever it happens to be listed.
 *
 * The strips on the home screen carry four fields per row, which is right for
 * scanning and useless for changing anything — and walking into the task to
 * move a due date means losing the screen he opened to see what needed doing.
 *
 * The task is fetched when he opens the editor, not carried by every query
 * that shows a title: one row, once, and only when he actually wants it.
 */
export function InlineTaskEditor({
  taskId,
  departments,
  people,
  label = 'EDIT',
}: {
  taskId: string;
  departments: { id: string; label: string }[];
  people: { id: string; label: string }[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<{
    id: string;
    layer: string;
    title: string;
    description: string | null;
    priority: 'P0' | 'P1' | 'P2' | 'P3';
    status: string;
    dueDate: string | null;
    deptId: string | null;
    ownerPersonId: string | null;
    tags: string[];
    moneyImpactCents: number | null;
  } | null>(null);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (task) return;
    setLoading(true);
    taskForEditAction(taskId)
      .then((r) => {
        if (r.ok) setTask(r.task);
        else setError(r.error ?? 'Could not open it');
      })
      .catch(() => setError('Could not open it'))
      .finally(() => setLoading(false));
  };

  return (
    <>
      <Button type="button" size="xs" variant={open ? 'default' : 'ghost'} onClick={toggle}>
        {open ? 'CLOSE' : label}
      </Button>

      {open ? (
        <div className="mt-2 w-full border border-divider p-2">
          {loading ? (
            <p className="text-[13px] text-neutral-500">Opening it…</p>
          ) : error ? (
            <p className="text-[13px] text-sev-warning">{error}</p>
          ) : task ? (
            <EditTaskForm
              mode={task.layer === 'company' ? 'clickup' : 'mine'}
              task={task}
              departments={departments}
              people={people}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
