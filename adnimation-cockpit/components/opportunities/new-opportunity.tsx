'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { captureSlackAction, createOpportunityAction } from '@/app/actions/opportunities';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { KIND_LABEL, OPPORTUNITY_KINDS } from '@/lib/opportunities/rules';

/**
 * Writing one down, in the two ways he actually gets them.
 *
 * By hand is the common case and is kept to one line plus optional detail —
 * an opportunity he has to fill a form for is an opportunity he does not
 * write down. From Slack is a paste of the message link, because retyping
 * what somebody said is the step where capture stops happening.
 */
export function NewOpportunity() {
  const [open, setOpen] = useState<'none' | 'manual' | 'slack'>('none');
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  if (open === 'none') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => setOpen('manual')}>
          WRITE ONE DOWN
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen('slack')}>
          FROM SLACK
        </Button>
      </div>
    );
  }

  if (open === 'slack') {
    return (
      <div className="w-full border border-divider p-3">
        <form
          ref={formRef}
          className="space-y-2"
          action={(formData) => {
            startTransition(async () => {
              const result = await captureSlackAction(formData);
              setErrors(result.fieldErrors ?? {});
              setMessage(result.ok ? null : (result.error ?? null));
              setWarning(result.warning ?? null);
              if (result.ok) {
                formRef.current?.reset();
                router.refresh();
                if (!result.warning) setOpen('none');
              }
            });
          }}
        >
          <div>
            <Label htmlFor="op-permalink">Slack message link</Label>
            <Input
              id="op-permalink"
              name="permalink"
              required
              placeholder="https://adnimation.slack.com/archives/C123.../p1712..."
            />
            {errors.permalink ? (
              <p className="mt-0.5 text-2xs text-destructive">{errors.permalink[0]}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="op-slack-title">Name it (optional)</Label>
            <Input id="op-slack-title" name="title" placeholder="Taken from the message if blank" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'READING…' : 'CAPTURE IT'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen('none')}>
              CANCEL
            </Button>
            <span className="font-semi text-[10px] tracking-[0.1em] text-neutral-500">
              IN SLACK: MORE ACTIONS → COPY LINK
            </span>
            {message ? <span className="text-2xs text-destructive">{message}</span> : null}
            {warning ? <span className="text-2xs text-sev-warning">{warning}</span> : null}
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full border border-divider p-3">
      <form
        ref={formRef}
        className="space-y-2"
        action={(formData) => {
          startTransition(async () => {
            const result = await createOpportunityAction(formData);
            setErrors(result.fieldErrors ?? {});
            setMessage(result.ok ? null : (result.error ?? null));
            if (result.ok) {
              formRef.current?.reset();
              router.refresh();
              setOpen('none');
            }
          });
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor="op-title">Name it</Label>
            <Input
              id="op-title"
              name="title"
              required
              placeholder="Talk to Markito about their second site"
            />
            {errors.title ? (
              <p className="mt-0.5 text-2xs text-destructive">{errors.title[0]}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="op-kind">Kind</Label>
            <Select id="op-kind" name="kind" defaultValue="other" className="w-full">
              {OPPORTUNITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="op-value">Worth roughly</Label>
            <Input id="op-value" name="value" placeholder="50k, 1.2m, 8000" />
            {errors.valueCents ? (
              <p className="mt-0.5 text-2xs text-destructive">Use a number like 50k or 1.2m</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="op-counterparty">Who with</Label>
            <Input id="op-counterparty" name="counterparty" placeholder="Company or person" />
          </div>

          <div>
            <Label htmlFor="op-next">Next step</Label>
            <Input id="op-next" name="nextStep" placeholder="Email Ravit" />
          </div>

          <div>
            <Label htmlFor="op-next-date">By when</Label>
            <Input id="op-next-date" name="nextStepDate" type="date" />
            {errors.nextStepDate ? (
              <p className="mt-0.5 text-2xs text-destructive">{errors.nextStepDate[0]}</p>
            ) : null}
          </div>

          <div className="sm:col-span-2 xl:col-span-4">
            <Label htmlFor="op-note">Detail</Label>
            <Textarea id="op-note" name="note" rows={2} placeholder="Why it is worth doing" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'SAVING…' : 'SAVE IT'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen('none')}>
            CANCEL
          </Button>
          <span className="font-semi text-[10px] tracking-[0.1em] text-neutral-500">
            NO NEXT STEP IS FINE — IT WILL SHOW AS NEEDING ONE
          </span>
          {message ? <span className="text-2xs text-destructive">{message}</span> : null}
        </div>
      </form>
    </div>
  );
}
