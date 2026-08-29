'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createTaskAction } from '@/app/actions/tasks';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { PRIORITY_META, TASK_PRIORITIES } from '@/lib/tasks/types';

/** Spec 6.1.1 — native task creation, with the fields the heat score needs. */
export function NewTaskForm({
  departments,
  people,
  parentId,
}: {
  departments: { id: string; label: string }[];
  people: { id: string; label: string }[];
  parentId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      className="space-y-2"
      action={(formData) => {
        startTransition(async () => {
          const result = await createTaskAction(formData);
          setErrors(result.fieldErrors ?? {});
          setFormError(result.ok ? null : (result.error ?? null));
          if (result.ok) {
            formRef.current?.reset();
            setExpanded(false);
            router.refresh();
          }
        });
      }}
    >
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Label htmlFor="new-task-title">כותרת</Label>
          <Input id="new-task-title" name="title" required placeholder="מה צריך לקרות?" />
          {errors.title ? <p className="mt-0.5 text-2xs text-destructive">{errors.title[0]}</p> : null}
        </div>

        <div>
          <Label htmlFor="new-task-priority">עדיפות</Label>
          <Select id="new-task-priority" name="priority" defaultValue="P2">
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{p} — {PRIORITY_META[p].label}</option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="new-task-due">תאריך יעד</Label>
          <Input id="new-task-due" name="dueDate" type="date" />
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? 'שומר…' : 'הוספה'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'פחות שדות' : 'עוד שדות'}
        </Button>
      </div>

      {expanded ? (
        <div className="grid gap-2 border-t pt-2 md:grid-cols-3">
          <div className="md:col-span-3">
            <Label htmlFor="new-task-description">תיאור</Label>
            <Textarea id="new-task-description" name="description" rows={2} />
          </div>
          <div>
            <Label htmlFor="new-task-dept">מחלקה</Label>
            <Select id="new-task-dept" name="deptId" defaultValue="" className="w-full">
              <option value="">ללא</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="new-task-owner">בעלים</Label>
            <Select id="new-task-owner" name="ownerPersonId" defaultValue="" className="w-full">
              <option value="">אני</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="new-task-money">השפעה כספית (USD)</Label>
            <Input id="new-task-money" name="moneyImpact" type="number" min="0" step="1" dir="ltr" />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="new-task-tags">תגיות (מופרדות בפסיק)</Label>
            <Input id="new-task-tags" name="tags" placeholder="supply, ctv" />
          </div>
          <div>
            <Label htmlFor="new-task-recurrence">חזרתיות (RRULE)</Label>
            <Input id="new-task-recurrence" name="recurrenceRule" dir="ltr" placeholder="FREQ=WEEKLY;BYDAY=SU" />
          </div>
        </div>
      ) : null}

      {formError ? <p className="text-2xs text-destructive">{formError}</p> : null}
    </form>
  );
}
