'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useUndo } from '@/components/ui/undo-bar';
import { archiveTaskAction, updateTaskAction } from '@/app/actions/tasks';
import { detachFromClickUpAction, editClickUpTaskAction } from '@/app/actions/clickup-tasks';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
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
}: {
  task: EditableTask;
  departments: { id: string; label: string }[];
  people: { id: string; label: string }[];
  mode?: 'mine' | 'clickup';
}) {
  const mirrored = mode === 'clickup';
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const undo = useUndo();

  return (
    <form
      className="space-y-2"
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
          }
        });
      }}
    >
      <input type="hidden" name="id" value={task.id} />

      <div>
        <Label htmlFor="edit-title">Title</Label>
        <Input id="edit-title" name="title" defaultValue={task.title} required />
      </div>

      <div>
        <Label htmlFor="edit-description">Description</Label>
        <Textarea id="edit-description" name="description" rows={4} defaultValue={task.description ?? ''} />
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <div>
          <Label htmlFor="edit-priority">Priority</Label>
          <Select id="edit-priority" name="priority" defaultValue={task.priority} className="w-full">
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{p} — {PRIORITY_META[p].label}</option>
            ))}
          </Select>
        </div>
        {mirrored ? null : (
          <div>
            <Label htmlFor="edit-status">Status</Label>
            <Select id="edit-status" name="status" defaultValue={task.status} className="w-full">
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="edit-due">Due date</Label>
          <Input id="edit-due" name="dueDate" type="date" defaultValue={task.dueDate ?? ''} />
        </div>
        {/*
          The next move, and when that move happens. A due date is when the
          whole thing has to be finished; on a list he works down, what happens
          next is the more useful of the two — which is why the deals board has
          carried both from the start.
        */}
        <div className="sm:col-span-2">
          <Label htmlFor="edit-next-step">What is the next move</Label>
          <Input
            id="edit-next-step"
            name="nextStep"
            defaultValue={task.nextStep ?? ''}
            placeholder="Send the deck, chase Amir, book the call…"
          />
        </div>
        <div>
          <Label htmlFor="edit-next-step-date">Next move due</Label>
          <Input
            id="edit-next-step-date"
            name="nextStepDate"
            type="date"
            defaultValue={task.nextStepDate ?? ''}
          />
        </div>
        {/*
          The start date and the recurrence were the two fields the row could
          show but not change, which meant a task that repeats had to be opened
          on its own page to stop repeating.
        */}
        <div>
          <Label htmlFor="edit-start">Start date</Label>
          <Input
            id="edit-start"
            name="startDate"
            type="date"
            defaultValue={task.startDate ?? ''}
          />
        </div>
        <div>
          <Label htmlFor="edit-dept">Department</Label>
          <Select id="edit-dept" name="deptId" defaultValue={task.deptId ?? ''} className="w-full">
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="edit-owner">Owner</Label>
          <Select id="edit-owner" name="ownerPersonId" defaultValue={task.ownerPersonId ?? ''} className="w-full">
            <option value="">Me</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="edit-money">Money impact (USD)</Label>
          <Input
            id="edit-money"
            name="moneyImpact"
            type="number"
            min="0"
            step="1"
            dir="ltr"
            defaultValue={task.moneyImpactCents === null ? '' : task.moneyImpactCents / 100}
          />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="edit-tags">Tags (comma separated)</Label>
          <Input id="edit-tags" name="tags" defaultValue={task.tags.join(', ')} />
        </div>
        <div>
          <Label htmlFor="edit-recurrence">Repeats (RRULE, blank for never)</Label>
          <Input
            id="edit-recurrence"
            name="recurrenceRule"
            dir="ltr"
            placeholder="FREQ=WEEKLY;BYDAY=MO"
            defaultValue={task.recurrenceRule ?? ''}
          />
        </div>
      </div>

      {/*
        Which half of this form goes where. Without it, a department that
        never appears in ClickUp and a title that does look identical, and the
        first surprise is a colleague asking why the task was renamed.
      */}
      {mirrored ? (
        <p className="text-2xs text-neutral-500">
          Title, description, priority and due date are written to ClickUp — the team sees them.
          Department, owner, tags and money impact are kept here only, and the next sync will
          leave them alone now that you have set them.
        </p>
      ) : null}

      {message ? <p className="text-2xs text-destructive">{message}</p> : null}
      {saved && !message ? <p className="text-2xs text-sev-ok">Saved.</p> : null}

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={pending}>{pending ? 'SAVING…' : 'SAVE'}</Button>
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
            DETACH FROM CLICKUP
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
      </div>
    </form>
  );
}
