'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createDelegationAction } from '@/app/actions/delegations';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { PRIORITY_META, TASK_PRIORITIES } from '@/lib/tasks/types';
import { DELEGATION_TARGETS, TARGET_LABEL } from '@/lib/delegation/rules';

/**
 * Handing something over.
 *
 * Sends a Slack message to that person and, unless he says otherwise, creates
 * the matching ClickUp task in the department's list. Somebody with no Slack id
 * cannot be sent to, so the form says so on the option rather than failing
 * after the click.
 */
export function NewDelegation({
  team,
  sharedThreads,
}: {
  team: { id: string; name: string; email: string; slackId: string | null; role: string | null }[];
  /** Whether Slack lets the cockpit put him in the conversation as well. */
  sharedThreads: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Which of the three ways it goes out, so the form can ask for the one
  // extra thing a channel or an address needs.
  const [how, setHow] = useState<string>('person');
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  const reachable = team.filter((p) => p.slackId);

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Hand something over
      </Button>
    );
  }

  return (
    <div className="w-full border border-line p-3">
      <form
        ref={formRef}
        className="space-y-2"
        action={(formData) => {
          startTransition(async () => {
            const result = await createDelegationAction(formData);
            setErrors(result.fieldErrors ?? {});
            setFormError(result.ok ? null : (result.error ?? null));
            setWarning(result.warning ?? null);
            if (result.ok) {
              formRef.current?.reset();
              router.refresh();
              if (!result.warning) setOpen(false);
            }
          });
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor="dl-title">What are you handing over</Label>
            <Input id="dl-title" name="title" required placeholder="Chase the Markito renewal" />
            {errors.title ? (
              <p className="mt-0.5 text-2xs text-destructive">{errors.title[0]}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="dl-to">To</Label>
            <Select id="dl-to" name="delegatedTo" required defaultValue="" className="w-full">
              <option value="" disabled>
                Pick someone
              </option>
              {reachable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.role ? ` — ${p.role}` : ''}
                </option>
              ))}
              {team
                .filter((p) => !p.slackId)
                .map((p) => (
                  <option key={p.id} value={p.id} disabled>
                    {p.name} — no Slack id, cannot be reached
                  </option>
                ))}
            </Select>
            {errors.delegatedTo ? (
              <p className="mt-0.5 text-2xs text-destructive">{errors.delegatedTo[0]}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="dl-due">Due</Label>
            <Input id="dl-due" name="dueDate" type="date" />
            {errors.dueDate ? (
              <p className="mt-0.5 text-2xs text-destructive">{errors.dueDate[0]}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="dl-priority">Priority</Label>
            <Select id="dl-priority" name="priority" defaultValue="P2" className="w-full">
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p} — {PRIORITY_META[p].label}
                </option>
              ))}
            </Select>
          </div>

          {/*
            Where it is delivered. A direct message is what most of these are;
            a channel is for work that belongs to a team rather than a name;
            email is for the people who have no Slack at all.

            The ClickUp list and the "also create a task" tick used to sit here.
            Both are gone: he no longer keeps ClickUp up to date, and most of
            the team never had it, so the ticket was tracking nothing.
          */}
          <div>
            <Label htmlFor="dl-how">How it reaches them</Label>
            <Select
              id="dl-how"
              name="targetKind"
              value={how}
              onChange={(e) => setHow(e.target.value)}
              className="w-full"
            >
              {DELEGATION_TARGETS.map((t) => (
                <option key={t} value={t}>
                  {TARGET_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>

          {how === 'person' ? null : (
            <div>
              <Label htmlFor="dl-where">
                {how === 'channel' ? 'Which channel' : 'Which address'}
              </Label>
              <Input
                id="dl-where"
                name="targetRef"
                dir="ltr"
                placeholder={how === 'channel' ? '#trading, or C01ABCDEF' : 'their@company.com'}
              />
            </div>
          )}

          <div className="sm:col-span-2 xl:col-span-4">
            <Label htmlFor="dl-note">Context</Label>
            <Textarea
              id="dl-note"
              name="note"
              rows={2}
              placeholder="What they need to know to actually do it"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'SENDING…' : 'SEND IT'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <span className="font-semi text-[11.5px] tracking-[0.1em] text-neutral-500">
            {sharedThreads
              ? 'SENT AS A SLACK THREAD WITH BOTH OF YOU — IT APPEARS IN YOUR SLACK TOO'
              : 'SENT AS A SLACK DM TO THEM — READ IT UNDER “CONVERSATION” BELOW'}
          </span>
          {formError ? <span className="text-2xs text-destructive">{formError}</span> : null}
          {warning ? <span className="text-2xs text-sev-warning">{warning}</span> : null}
        </div>
      </form>
    </div>
  );
}
