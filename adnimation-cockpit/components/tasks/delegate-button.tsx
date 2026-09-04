'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { delegateAction } from '@/app/actions/delegate';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { PRIORITY_META, TASK_PRIORITIES, type TaskPriority } from '@/lib/tasks/types';

/**
 * Spec 6.1.3 — the delegate flow: pick a person, review the drafted task,
 * confirm. Sends a Slack message and creates a ClickUp task in one step.
 */
export function DelegateButton({
  sourceEntityId,
  sourceEntityType = 'task',
  defaultTitle,
  defaultPriority = 'P2',
  defaultDueDate,
  people,
}: {
  sourceEntityId: string;
  sourceEntityType?: 'task' | 'alert' | 'contract' | 'partner' | 'deal';
  defaultTitle: string;
  defaultPriority?: TaskPriority;
  defaultDueDate?: string | null;
  people: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  if (!open) {
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)} title="Delegate to the team">
        Delegate
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-4 text-right">
        <h2 className="hud-heading text-[21px] text-neutral-900">Delegate task</h2>
        <p className="mt-0.5 text-2xs text-muted-foreground">
          Sends a Slack message and creates a linked ClickUp task.
        </p>

        <form
          className="mt-3 space-y-2"
          action={(formData) => {
            startTransition(async () => {
              const result = await delegateAction(formData);
              if (result.ok && !result.error) {
                setOpen(false);
                setMessage(null);
                router.refresh();
              } else {
                setMessage(result.error ?? 'Delegation failed');
                if (result.ok) router.refresh();
              }
            });
          }}
        >
          <input type="hidden" name="sourceEntityType" value={sourceEntityType} />
          <input type="hidden" name="sourceEntityId" value={sourceEntityId} />

          <div>
            <Label htmlFor="delegatedTo">Assign to</Label>
            <Select id="delegatedTo" name="delegatedTo" required className="w-full">
              <option value="">Choose a person…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="delegate-title">What needs to happen</Label>
            <Input id="delegate-title" name="title" defaultValue={defaultTitle} required />
          </div>

          <div>
            <Label htmlFor="note">Context</Label>
            <Textarea id="note" name="note" rows={3} placeholder="Why it matters, what has already been done" />
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="delegate-due">Due date</Label>
              <Input id="delegate-due" name="dueDate" type="date" defaultValue={defaultDueDate ?? ''} />
            </div>
            <div>
              <Label htmlFor="delegate-priority">Priority</Label>
              <Select id="delegate-priority" name="priority" defaultValue={defaultPriority}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p} — {PRIORITY_META[p].label}</option>
                ))}
              </Select>
            </div>
          </div>

          {message ? <p className="text-2xs text-destructive">{message}</p> : null}

          <div className="flex justify-start gap-2 pt-1">
            <Button type="submit" disabled={pending}>
              {pending ? 'SENDING…' : 'SEND'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
