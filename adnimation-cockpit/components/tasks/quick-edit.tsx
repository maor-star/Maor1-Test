'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateTaskAction } from '@/app/actions/tasks';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { PRIORITY_META, TASK_PRIORITIES } from '@/lib/tasks/types';

/**
 * The whole task, edited from its row.
 *
 * The cells cover the columns that are on screen — status, owner, priority,
 * due, department — and nothing else, so changing a next step or a description
 * still meant opening the task, editing it, saving, and finding his place in
 * the list again. That is the trip this screen exists to remove.
 *
 * So: a chevron at the end of every row opens the whole task underneath it,
 * saved in one post. It is a form rather than a set of cells because it is a
 * sitting-down edit — several fields at once, one Save, and Escape to leave
 * without writing anything.
 *
 * It opens as a row rather than floating over one: the group is a card with
 * its corners clipped, so a panel positioned over the rows would have been cut
 * off at the card's edge — and a panel covering the next three tasks is worse
 * than one that pushes them down anyway.
 */
export interface QuickEditTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  startDate: string | null;
  nextStep: string | null;
  nextStepDate: string | null;
  deptId: string | null;
  ownerPersonId: string | null;
  tags: string[];
  moneyImpactCents: number | null;
  /** Mirrored tasks are written to ClickUp first; the panel says so. */
  layer: 'mine' | 'company';
}

export function QuickEditPanel({
  task,
  statusOptions,
  ownerOptions,
  deptOptions,
  onClose,
}: {
  task: QuickEditTask;
  statusOptions: { value: string; label: string }[];
  ownerOptions: { value: string; label: string }[];
  deptOptions: { value: string; label: string }[];
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Escape leaves without writing anything, the way it does in every other
  // editor here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = (form: HTMLFormElement) => {
    const data = new FormData(form);
    data.set('id', task.id);
    setError(null);
    startTransition(async () => {
      const result = await updateTaskAction(data);
      if (!result.ok) {
        setError(result.error ?? 'That did not save');
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(e.currentTarget);
      }}
      className="space-y-2.5 border-s-[3px] border-accent bg-neutral-50 px-[14px] py-3"
    >
      <Field label="Task">
        <Input name="title" defaultValue={task.title} required maxLength={300} />
      </Field>

      <Field label="Description">
        <Textarea name="description" rows={3} defaultValue={task.description ?? ''} />
      </Field>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Next step">
          <Input name="nextStep" defaultValue={task.nextStep ?? ''} />
        </Field>
        <Field label="Next step date">
          <Input type="date" dir="ltr" name="nextStepDate" defaultValue={task.nextStepDate ?? ''} />
        </Field>

        <Field label="Status">
          <Select name="status" defaultValue={task.status}>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select name="priority" defaultValue={task.priority}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p} {PRIORITY_META[p].label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Owner">
          <Select name="ownerPersonId" defaultValue={task.ownerPersonId ?? ''}>
            {ownerOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Department">
          <Select name="deptId" defaultValue={task.deptId ?? ''}>
            {deptOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Start">
          <Input type="date" dir="ltr" name="startDate" defaultValue={task.startDate ?? ''} />
        </Field>
        <Field label="Due">
          <Input type="date" dir="ltr" name="dueDate" defaultValue={task.dueDate ?? ''} />
        </Field>

        <Field label="Tags">
          <Input name="tags" defaultValue={task.tags.join(', ')} placeholder="comma separated" />
        </Field>
        <Field label="Money impact ($)">
          <Input
            type="number"
            dir="ltr"
            min={0}
            step="0.01"
            name="moneyImpact"
            defaultValue={task.moneyImpactCents === null ? '' : task.moneyImpactCents / 100}
          />
        </Field>
      </div>

      {error ? <p className="text-[12.5px] text-neg">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <span className="text-[11.5px] text-muted">
          {task.layer === 'company'
            ? 'Mirrored from ClickUp — written there first, and kept here only once it accepts.'
            : 'Yours, saved here.'}
        </span>
        <span className="flex gap-2">
          <Button type="button" size="xs" variant="outline" onClick={onClose}>
            CANCEL
          </Button>
          <Button type="submit" size="xs" disabled={pending}>
            {pending ? 'SAVING…' : 'SAVE'}
          </Button>
        </span>
      </div>
    </form>
  );
}

/** The chevron that opens it. Its own component so the row stays readable. */
export function QuickEditToggle({
  open,
  onToggle,
  title,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`Quick edit — ${title}`}
      title="Edit everything on this task without opening it"
      onClick={onToggle}
      className="justify-self-center rounded-[5px] px-1.5 py-1 text-[11px] leading-none text-muted hover:bg-neutral-100 hover:text-ink"
    >
      {open ? '▴' : '▾'}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="hud-label block text-[10.5px]">{label}</span>
      {children}
    </label>
  );
}
