'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { archiveTaskAction, updateTaskAction } from '@/app/actions/tasks';
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
  deptId: string | null;
  ownerPersonId: string | null;
  tags: string[];
  moneyImpactCents: number | null;
}

export function EditTaskForm({
  task,
  departments,
  people,
}: {
  task: EditableTask;
  departments: { id: string; label: string }[];
  people: { id: string; label: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  return (
    <form
      className="space-y-2"
      action={(formData) => {
        startTransition(async () => {
          const result = await updateTaskAction(formData);
          setMessage(result.ok ? null : (result.error ?? 'העדכון נכשל'));
          setSaved(result.ok);
          if (result.ok) router.refresh();
        });
      }}
    >
      <input type="hidden" name="id" value={task.id} />

      <div>
        <Label htmlFor="edit-title">כותרת</Label>
        <Input id="edit-title" name="title" defaultValue={task.title} required />
      </div>

      <div>
        <Label htmlFor="edit-description">תיאור</Label>
        <Textarea id="edit-description" name="description" rows={4} defaultValue={task.description ?? ''} />
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <div>
          <Label htmlFor="edit-priority">עדיפות</Label>
          <Select id="edit-priority" name="priority" defaultValue={task.priority} className="w-full">
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{p} — {PRIORITY_META[p].label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="edit-status">סטטוס</Label>
          <Select id="edit-status" name="status" defaultValue={task.status} className="w-full">
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="edit-due">תאריך יעד</Label>
          <Input id="edit-due" name="dueDate" type="date" defaultValue={task.dueDate ?? ''} />
        </div>
        <div>
          <Label htmlFor="edit-dept">מחלקה</Label>
          <Select id="edit-dept" name="deptId" defaultValue={task.deptId ?? ''} className="w-full">
            <option value="">ללא</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="edit-owner">בעלים</Label>
          <Select id="edit-owner" name="ownerPersonId" defaultValue={task.ownerPersonId ?? ''} className="w-full">
            <option value="">אני</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="edit-money">השפעה כספית (USD)</Label>
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

      <div>
        <Label htmlFor="edit-tags">תגיות (מופרדות בפסיק)</Label>
        <Input id="edit-tags" name="tags" defaultValue={task.tags.join(', ')} />
      </div>

      {message ? <p className="text-2xs text-destructive">{message}</p> : null}
      {saved && !message ? <p className="text-2xs text-sev-ok">נשמר.</p> : null}

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={pending}>{pending ? 'שומר…' : 'שמירה'}</Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            // Nothing is ever deleted — archive only (CLAUDE.md §2).
            if (!window.confirm('להעביר את המשימה לארכיון?')) return;
            const fd = new FormData();
            fd.set('id', task.id);
            startTransition(async () => {
              const result = await archiveTaskAction(fd);
              if (result.ok) router.push('/tasks');
              else setMessage(result.error ?? 'הארכוב נכשל');
            });
          }}
        >
          לארכיון
        </Button>
      </div>
    </form>
  );
}
