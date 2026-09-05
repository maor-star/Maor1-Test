'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useUndo } from '@/components/ui/undo-bar';
import { savePipelineClientAction } from '@/app/actions/pipeline';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { EditorActions, EditorField, EditorGrid } from '@/components/hud/editor-panel';
import { PillarPicker } from '@/components/hud/pillar-picker';
import {
  CLIENT_TYPES, CLIENT_TYPE_LABEL, OPEN_STAGES, STAGES, STAGE_LABEL, TEMPERATURES,
  TEMPERATURE_LABEL, type Stage,
} from '@/lib/pipeline/types';
import type { PipelineRow } from '@/lib/pipeline/service';

/**
 * Add or edit a client in the pipeline, in the shape the contracts card set:
 * a caption over every control, four across, the notes spanning the width at
 * the bottom, and one row saying what the save is going to do.
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
  lines = [],
}: {
  owners: { id: string; name: string }[];
  client?: PipelineRow;
  onDone?: () => void;
  /** The pillars it already belongs to. */
  lines?: readonly string[];
}) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(client?.stage ?? 'open_new');
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const undo = useUndo();

  const needsStep = OPEN_STAGES.includes(stage);
  const f = (name: string) => `pl-${name}-${client?.id ?? 'new'}`;

  return (
    <form
      ref={formRef}
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
        <p className="mb-3 rounded-[10px] border border-neg/50 bg-neg/10 px-3 py-2 text-[13px] text-ink">
          {formError ?? 'Not saved — see the fields marked below.'}
        </p>
      ) : null}

      <EditorGrid>
        <EditorField
          label="Who it is with"
          htmlFor={f('name')}
          span={2}
          error={errors.name?.[0] ?? null}
        >
          <Input id={f('name')} name="name" required defaultValue={client?.name} placeholder="Company name" />
        </EditorField>

        <EditorField label="Type" htmlFor={f('type')}>
          <Select
            id={f('type')}
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
        </EditorField>

        <EditorField label="Stage" htmlFor={f('stage')}>
          <Select
            id={f('stage')}
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
        </EditorField>

        <EditorField
          label="What is the next move"
          htmlFor={f('step')}
          span={2}
          hint={needsStep ? 'Filled in for you if you leave it empty' : undefined}
          error={errors.nextStep?.[0] ?? null}
        >
          <Input
            id={f('step')}
            name="nextStep"
            defaultValue={client?.nextStep ?? ''}
            placeholder="Call Ravit about the IO"
          />
        </EditorField>

        <EditorField
          label="Next move due"
          htmlFor={f('stepdate')}
          hint={needsStep ? 'Tomorrow, if you leave it empty' : undefined}
          error={errors.nextStepDate?.[0] ?? null}
        >
          <Input
            id={f('stepdate')}
            name="nextStepDate"
            type="date"
            defaultValue={client?.nextStepDate ?? ''}
          />
        </EditorField>

        <EditorField label="Temperature" htmlFor={f('temp')}>
          <Select
            id={f('temp')}
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
        </EditorField>

        <EditorField label="Owner" htmlFor={f('owner')}>
          <Select
            id={f('owner')}
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
        </EditorField>

        <EditorField label="What it is worth (USD / month)" htmlFor={f('value')}>
          <Input
            id={f('value')}
            name="value"
            type="number"
            min="0"
            step="1"
            dir="ltr"
            defaultValue={client?.valueCents != null ? client.valueCents / 100 : ''}
          />
        </EditorField>

        <EditorField label="Probability (%)" htmlFor={f('prob')}>
          <Input
            id={f('prob')}
            name="probability"
            type="number"
            min="0"
            max="100"
            dir="ltr"
            defaultValue={client?.probability ?? ''}
          />
        </EditorField>

        <EditorField label="Domain" htmlFor={f('domain')}>
          <Input
            id={f('domain')}
            name="domain"
            defaultValue={client?.domain ?? ''}
            placeholder="example.com"
          />
        </EditorField>

        <EditorField label="Where it came from" htmlFor={f('source')}>
          <Input
            id={f('source')}
            name="source"
            defaultValue={client?.source ?? ''}
            placeholder="Conference, referral, inbound"
          />
        </EditorField>

        <EditorField
          label="Which parts of the company"
          htmlFor={`${f('lines')}-core_clients`}
          span="full"
          hint="Tag it to as many pillars as it touches"
        >
          <PillarPicker id={f('lines')} selected={lines} />
        </EditorField>

        <EditorField label="Notes" htmlFor={f('notes')} span="full">
          <Textarea id={f('notes')} name="notes" rows={3} defaultValue={client?.notes ?? ''} />
        </EditorField>
      </EditorGrid>

      <EditorActions
        hint={
          needsStep
            ? 'AN OPEN DEAL ALWAYS ENDS UP WITH A NEXT MOVE AND A DATE · A SIGNED CONTRACT MOVES IT TO INTEGRATION'
            : 'A SIGNED CONTRACT MOVES A DEAL TO INTEGRATION · NOTHING HERE IS EVER DELETED'
        }
      >
        <Button type="submit" disabled={pending}>
          {pending ? 'SAVING…' : client ? 'SAVE IT' : 'ADD THE CLIENT'}
        </Button>
        {onDone ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
        {formError ? <span className="text-[12px] text-neg">{formError}</span> : null}
      </EditorActions>
    </form>
  );
}
