'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useUndo } from '@/components/ui/undo-bar';
import { archiveTaskAction, updateTaskAction } from '@/app/actions/tasks';
import { detachFromClickUpAction, editClickUpTaskAction } from '@/app/actions/clickup-tasks';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { EditorActions, EditorField, EditorGrid } from '@/components/hud/editor-panel';
import {
  PRIORITY_META, STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES, type TaskPriority,
} from '@/lib/tasks/types';

interface EditableTask {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: string;
  dueDate: string | null;
  startDate: string | null;
  nextStep: string | null;
  nextStepDate: string | null;
  recurrenceRule: string | null;
  deptId: string | null;
  ownerPersonId: string | null;
  tags: string[];
  moneyImpactCents: number | null;
}

/**
 * Editing a task, in the shape the contracts card set: a caption over every
 * control, four across, the description spanning the width at the bottom, and
 * one row saying what the save is going to do.
 */
export function EditTaskForm({
  task,
  departments,
  people,
  /**
   * A mirrored ClickUp task edits through ClickUp: the fields it owns are
   * written there first and only mirrored once accepted, and the fields it has
   * nowhere to keep are written here and pinned against the next poll. The
   * status is not in this form for those — it belongs to the task's own
   * ClickUp list, which has its own words for it.
   */
  mode = 'mine',
  /** Closes the editor. Absent on the task's own page, which has nothing to close. */
  onDone,
}: {
  task: EditableTask;
  departments: { id: string; label: string }[];
  people: { id: string; label: string }[];
  mode?: 'mine' | 'clickup';
  onDone?: () => void;
}) {
  const mirrored = mode === 'clickup';
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const undo = useUndo();
  // Unique per task: two of these can be open at once on the list.
  const f = (name: string) => `t-${name}-${task.id}`;

  return (
    <form
      action={(formData) => {
        startTransition(async () => {
          const result = mirrored
            ? await editClickUpTaskAction(formData)
            : await updateTaskAction(formData);
          setMessage(result.ok ? null : (result.error ?? 'Update failed'));
          setSaved(result.ok);
          if (result.ok) {
            undo.offer();
            router.refresh();
            onDone?.();
          }
        });
      }}
    >
      <input type="hidden" name="id" value={task.id} />

      <EditorGrid>
        <EditorField label="What the task is" htmlFor={f('title')} span={2}>
          <Input id={f('title')} name="title" defaultValue={task.title} required />
        </EditorField>

        <EditorField label="Priority" htmlFor={f('priority')}>
          <Select id={f('priority')} name="priority" defaultValue={task.priority} className="w-full">
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{p} — {PRIORITY_META[p].label}</option>
            ))}
          </Select>
        </EditorField>

        {mirrored ? null : (
          <EditorField label="Status" htmlFor={f('status')}>
            <Select id={f('status')} name="status" defaultValue={task.status} className="w-full">
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </EditorField>
        )}

        {/*
          The next move, and when that move happens. A due date is when the
          whole thing has to be finished; on a list he works down, what happens
          next is the more useful of the two — which is why the deals board has
          carried both from the start.
        */}
        <EditorField label="What is the next move" htmlFor={f('next-step')} span={2}>
          <Input
            id={f('next-step')}
            name="nextStep"
            defaultValue={task.nextStep ?? ''}
            placeholder="Send the deck, chase Amir, book the call…"
          />
        </EditorField>

        <EditorField label="Next move due" htmlFor={f('next-step-date')}>
          <Input
            id={f('next-step-date')}
            name="nextStepDate"
            type="date"
            defaultValue={task.nextStepDate ?? ''}
          />
        </EditorField>

        <EditorField label="Due date" htmlFor={f('due')}>
          <Input id={f('due')} name="dueDate" type="date" defaultValue={task.dueDate ?? ''} />
        </EditorField>

        {/*
          The start date and the recurrence were the two fields the row could
          show but not change, which meant a task that repeats had to be opened
          on its own page to stop repeating.
        */}
        <EditorField label="Start date" htmlFor={f('start')}>
          <Input id={f('start')} name="startDate" type="date" defaultValue={task.startDate ?? ''} />
        </EditorField>

        <EditorField label="Department" htmlFor={f('dept')}>
          <Select id={f('dept')} name="deptId" defaultValue={task.deptId ?? ''} className="w-full">
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </Select>
        </EditorField>

        <EditorField label="Owner" htmlFor={f('owner')}>
          <Select
            id={f('owner')}
            name="ownerPersonId"
            defaultValue={task.ownerPersonId ?? ''}
            className="w-full"
          >
            <option value="">Me</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </Select>
        </EditorField>

        <EditorField label="What it is worth (USD)" htmlFor={f('money')}>
          <Input
            id={f('money')}
            name="moneyImpact"
            type="number"
            min="0"
            step="1"
            dir="ltr"
            defaultValue={task.moneyImpactCents === null ? '' : task.moneyImpactCents / 100}
          />
        </EditorField>

        <EditorField label="Tags" htmlFor={f('tags')} hint="Separated by commas">
          <Input id={f('tags')} name="tags" defaultValue={task.tags.join(', ')} />
        </EditorField>

        <EditorField label="Repeats" htmlFor={f('recurrence')} hint="Leave it empty for never">
          <Input
            id={f('recurrence')}
            name="recurrenceRule"
            dir="ltr"
            placeholder="FREQ=WEEKLY;BYDAY=MO"
            defaultValue={task.recurrenceRule ?? ''}
          />
        </EditorField>

        <EditorField label="Notes" htmlFor={f('description')} span="full">
          <Textarea
            id={f('description')}
            name="description"
            rows={3}
            defaultValue={task.description ?? ''}
          />
        </EditorField>
      </EditorGrid>

      {message ? <p className="mt-2 text-[12px] text-neg">{message}</p> : null}
      {saved && !message ? <p className="mt-2 text-[12px] text-pos">Saved.</p> : null}

      <EditorActions
        hint={
          /*
            Which half of this form goes where. Without it, a department that
            never appears in ClickUp and a title that does look identical, and
            the first surprise is a colleague asking why the task was renamed.
          */
          mirrored
            ? 'THE TITLE, THE NOTES, THE PRIORITY AND THE DUE DATE GO TO CLICKUP — THE TEAM SEES THEM · THE REST IS KEPT HERE AND THE NEXT SYNC LEAVES IT ALONE'
            : 'NOTHING HERE IS EVER DELETED — ARCHIVING TAKES IT OUT OF EVERY LIST'
        }
      >
        <Button type="submit" disabled={pending}>{pending ? 'SAVING…' : 'SAVE IT'}</Button>

        {onDone ? (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : null}

        {mirrored ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            title="Stop following the ClickUp task. It becomes yours, with your fields."
            onClick={() => {
              if (
                !window.confirm(
                  'Cut this task loose from ClickUp? It becomes yours to edit freely here, ' +
                    'and stops updating from ClickUp. The ClickUp task itself is left alone. ' +
                    'This cannot be undone.',
                )
              ) {
                return;
              }
              const fd = new FormData();
              fd.set('id', task.id);
              startTransition(async () => {
                const result = await detachFromClickUpAction(fd);
                setMessage(result.ok ? null : (result.error ?? 'Could not detach it'));
                if (result.ok) {
                  undo.offer();
                  router.refresh();
                }
              });
            }}
          >
            Detach from ClickUp
          </Button>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            // Nothing is ever deleted — archive only (CLAUDE.md §2).
            if (!window.confirm('Archive this task?')) return;
            const fd = new FormData();
            fd.set('id', task.id);
            startTransition(async () => {
              const result = await archiveTaskAction(fd);
              if (result.ok) {
                undo.offer();
                router.push('/tasks');
              }
              else setMessage(result.error ?? 'Archiving failed');
            });
          }}
        >
          Archive
        </Button>
      </EditorActions>
    </form>
  );
}
