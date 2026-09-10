'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateTaskAction } from '@/app/actions/tasks';

/**
 * One cell of the table, changed in place.
 *
 * The whole reason this screen exists: in Monday he changes a status by
 * clicking the status, not by opening the task, finding the field, saving and
 * finding his place in the list again. So each cell is its own one-field form
 * — `updateTaskAction` only writes the fields a form actually submits, so a
 * cell can send its own and leave everything else alone.
 *
 * It saves on change rather than on a button. There is no button in a Monday
 * cell and adding one here would make the row a form to fill in rather than a
 * thing to nudge.
 */
export function CellSelect({
  taskId,
  field,
  value,
  options,
  className,
  style,
  title,
}: {
  taskId: string;
  field: 'status' | 'priority' | 'ownerPersonId' | 'deptId';
  value: string;
  options: { value: string; label: string }[];
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const router = useRouter();

  return (
    <select
      aria-label={title ?? field}
      title={error ? 'That did not save' : title}
      disabled={pending}
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        const data = new FormData();
        data.set('id', taskId);
        data.set(field, next);
        setError(false);
        startTransition(async () => {
          const result = await updateTaskAction(data);
          // A failed save must not leave the cell showing the new value: the
          // row would read as changed while the task was not.
          setError(!result.ok);
          router.refresh();
        });
      }}
      className={`w-full cursor-pointer appearance-none border-0 bg-transparent px-2 py-1.5 text-center text-[12px] font-bold uppercase tracking-[0.06em] outline-none focus-visible:ring-2 focus-visible:ring-info ${
        pending ? 'opacity-60' : ''
      } ${error ? 'ring-2 ring-neg' : ''} ${className ?? ''}`}
      style={style}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-card text-ink">
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A date cell, same rule: it writes itself and nothing else. */
export function CellDate({
  taskId,
  field,
  value,
  title,
}: {
  taskId: string;
  field: 'dueDate' | 'nextStepDate';
  value: string | null;
  title?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const router = useRouter();

  return (
    <input
      type="date"
      aria-label={title ?? field}
      title={error ? 'That did not save' : title}
      disabled={pending}
      defaultValue={value ?? ''}
      onChange={(e) => {
        const data = new FormData();
        data.set('id', taskId);
        data.set(field, e.target.value);
        setError(false);
        startTransition(async () => {
          const result = await updateTaskAction(data);
          setError(!result.ok);
          router.refresh();
        });
      }}
      dir="ltr"
      className={`w-full cursor-pointer border-0 bg-transparent px-2 py-1.5 text-center font-mono text-[12.5px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-info ${
        pending ? 'opacity-60' : ''
      } ${error ? 'ring-2 ring-neg' : ''}`}
    />
  );
}
