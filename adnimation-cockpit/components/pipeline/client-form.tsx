'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useUndo } from '@/components/ui/undo-bar';
import { savePipelineClientAction } from '@/app/actions/pipeline';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import {
  CLIENT_TYPES, CLIENT_TYPE_LABEL, OPEN_STAGES, STAGES, STAGE_LABEL, TEMPERATURES,
  TEMPERATURE_LABEL, type Stage,
} from '@/lib/pipeline/types';
import type { PipelineRow } from '@/lib/pipeline/service';

/**
 * Add or edit a client in the pipeline.
 *
 * Typing a name and pressing ADD CLIENT is enough. An open deal still ends up
 * with a next step and a date — the server fills in a placeholder when he
 * leaves them empty — because a deal nobody has committed to move is what the
 * board exists to catch. What it no longer does is refuse the save.
 *
 * Anything that does fail says so at the top, in a colour, as well as under
 * the field: two lines of small red text at the bottom of a long form is how a
 * refused save reads as "nothing happened".
 */
export function PipelineClientForm({
  owners,
  client,
  onDone,
}: {
  owners: { id: string; name: string }[];
  client?: PipelineRow;
  onDone?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(client?.stage ?? 'open_new');
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const undo = useUndo();

  const needsStep = OPEN_STAGES.includes(stage);

  return (
    <form
      ref={formRef}
      className="space-y-2"
      action={(formData) => {
        startTransition(async () => {
          const result = await savePipelineClientAction(formData);
          setErrors(result.fieldErrors ?? {});
          setFormError(result.ok ? null : (result.error ?? null));
          if (result.ok) {
            if (!client) formRef.current?.reset();
            undo.offer();
            router.refresh();
            onDone?.();
          }
        });
      }}
    >
      {client ? <input type="hidden" name="id" value={client.id} /> : null}

      {formError || Object.keys(errors).length > 0 ? (
        <p className="border border-sev-critical/60 bg-sev-critical/10 px-2 py-1.5 text-[12px] text-neutral-900">
          {formError ?? 'Not saved — see the fields marked below.'}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="sm:col-span-2">
          <Label htmlFor={`pl-name-${client?.id ?? 'new'}`}>Client</Label>
          <Input
            id={`pl-name-${client?.id ?? 'new'}`}
            name="name"
            required
            defaultValue={client?.name}
            placeholder="Company name"
          />
          {errors.name ? <p className="mt-0.5 text-2xs text-destructive">{errors.name[0]}</p> : null}
        </div>

        <div>
          <Label htmlFor={`pl-type-${client?.id ?? 'new'}`}>Type</Label>
          <Select
            id={`pl-type-${client?.id ?? 'new'}`}
            name="clientType"
            defaultValue={client?.clientType ?? 'other'}
            className="w-full"
          >
            {CLIENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {CLIENT_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor={`pl-stage-${client?.id ?? 'new'}`}>Stage</Label>
          <Select
            id={`pl-stage-${client?.id ?? 'new'}`}
            name="stage"
            value={stage}
            onChange={(e) => setStage(e.target.value as Stage)}
            className="w-full"
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor={`pl-temp-${client?.id ?? 'new'}`}>Temperature</Label>
          <Select
            id={`pl-temp-${client?.id ?? 'new'}`}
            name="temperature"
            defaultValue={client?.temperature ?? 'warm'}
            className="w-full"
          >
            {TEMPERATURES.map((t) => (
              <option key={t} value={t}>
                {TEMPERATURE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor={`pl-owner-${client?.id ?? 'new'}`}>Owner</Label>
          <Select
            id={`pl-owner-${client?.id ?? 'new'}`}
            name="ownerPersonId"
            defaultValue={client?.ownerPersonId ?? ''}
            className="w-full"
          >
            <option value="">Me</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor={`pl-value-${client?.id ?? 'new'}`}>Value (USD / month)</Label>
          <Input
            id={`pl-value-${client?.id ?? 'new'}`}
            name="value"
            type="number"
            min="0"
            step="1"
            dir="ltr"
            defaultValue={client?.valueCents != null ? client.valueCents / 100 : ''}
          />
        </div>

        <div>
          <Label htmlFor={`pl-prob-${client?.id ?? 'new'}`}>Probability (%)</Label>
          <Input
            id={`pl-prob-${client?.id ?? 'new'}`}
            name="probability"
            type="number"
            min="0"
            max="100"
            dir="ltr"
            defaultValue={client?.probability ?? ''}
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor={`pl-step-${client?.id ?? 'new'}`}>
            Next step {needsStep ? '(filled in for you if you leave it empty)' : '(optional)'}
          </Label>
          <Input
            id={`pl-step-${client?.id ?? 'new'}`}
            name="nextStep"
            defaultValue={client?.nextStep ?? ''}
            placeholder="Call Ravit about the IO"
          />
          {errors.nextStep ? (
            <p className="mt-0.5 text-2xs text-destructive">{errors.nextStep[0]}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor={`pl-stepdate-${client?.id ?? 'new'}`}>
            Next step date {needsStep ? '(tomorrow, if you leave it empty)' : ''}
          </Label>
          <Input
            id={`pl-stepdate-${client?.id ?? 'new'}`}
            name="nextStepDate"
            type="date"
            defaultValue={client?.nextStepDate ?? ''}
          />
          {errors.nextStepDate ? (
            <p className="mt-0.5 text-2xs text-destructive">{errors.nextStepDate[0]}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor={`pl-domain-${client?.id ?? 'new'}`}>Domain</Label>
          <Input
            id={`pl-domain-${client?.id ?? 'new'}`}
            name="domain"
            defaultValue={client?.domain ?? ''}
            placeholder="example.com"
          />
        </div>

        <div>
          <Label htmlFor={`pl-source-${client?.id ?? 'new'}`}>Source</Label>
          <Input
            id={`pl-source-${client?.id ?? 'new'}`}
            name="source"
            defaultValue={client?.source ?? ''}
            placeholder="Conference, referral, inbound"
          />
        </div>

        <div className="sm:col-span-2 xl:col-span-4">
          <Label htmlFor={`pl-notes-${client?.id ?? 'new'}`}>Notes</Label>
          <Textarea
            id={`pl-notes-${client?.id ?? 'new'}`}
            name="notes"
            rows={2}
            defaultValue={client?.notes ?? ''}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'SAVING…' : client ? 'SAVE' : 'ADD CLIENT'}
        </Button>
        {onDone ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
        {formError ? <span className="text-2xs text-destructive">{formError}</span> : null}
      </div>
    </form>
  );
}
