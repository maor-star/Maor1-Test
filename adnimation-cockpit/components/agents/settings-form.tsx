'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setSettingsAction } from '@/app/actions/agents';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { useUndo } from '@/components/ui/undo-bar';
import { SHOWN_SUFFIX, type SettingField, type Settings } from '@/lib/agents/settings';

/**
 * An agent's dials, as a form built from what the agent declares.
 *
 * The brief is free text for the corrections nobody anticipated. This is the
 * opposite: the handful of thresholds, windows and switches every run reads
 * directly, so changing one is a click rather than a sentence the model has
 * to interpret. The fields come from lib/agents/settings.ts — the screen
 * never knows an agent's dials by name, so a new one ships without a UI change.
 */
export function AgentSettingsForm({
  agentId,
  fields,
  values,
  onClose,
}: {
  agentId: string;
  fields: SettingField[];
  values: Settings;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  const undo = useUndo();

  if (fields.length === 0) {
    return (
      <p className="mt-2 font-semi text-[12px] text-neutral-500">
        This agent has nothing to set beyond its brief and its schedule.
      </p>
    );
  }

  return (
    <form
      className="mt-2 border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        data.set('id', agentId);
        startTransition(async () => {
          const result = await setSettingsAction(data);
          setMessage(result.ok ? (result.message ?? 'Saved') : (result.error ?? 'That did not work'));
          if (result.ok) {
            undo.offer();
            router.refresh();
            onClose();
          }
        });
      }}
    >
      <p className="hud-label mb-3 text-[11px]">Its dials — read at the top of every run</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {fields.map((f) => (
          <Field key={f.key} field={f} value={values[f.key]} agentId={agentId} />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'SAVING…' : 'SAVE THE DIALS'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {message ? (
          <span className="font-semi text-[11.5px] tracking-[0.1em] text-info">{message}</span>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  field: f,
  value,
  agentId,
}: {
  field: SettingField;
  value: Settings[string] | undefined;
  agentId: string;
}) {
  const id = `set-${agentId}-${f.key}`;
  const help = f.help ? <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">{f.help}</p> : null;

  switch (f.type) {
    case 'number':
      return (
        <div>
          <Label htmlFor={id}>
            {f.label}
            {f.unit ? <span className="ms-1 text-neutral-500">({f.unit})</span> : null}
          </Label>
          <Input
            id={id}
            name={f.key}
            type="number"
            dir="ltr"
            defaultValue={typeof value === 'number' ? value : f.default}
            min={f.min}
            max={f.max}
            step={f.step ?? 1}
          />
          {help}
        </div>
      );
    case 'boolean':
      return (
        <div className="flex items-start gap-2 pt-5">
          {/*
            The marker that says this checkbox was on the page. Without it an
            unticked box and a box the browser never rendered post the same
            thing — nothing — and a dial that shipped after his tab was opened
            gets switched off by a save that had nothing to do with it.
          */}
          <input type="hidden" name={`${f.key}${SHOWN_SUFFIX}`} value="1" />
          <input
            id={id}
            name={f.key}
            type="checkbox"
            value="1"
            defaultChecked={typeof value === 'boolean' ? value : f.default}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <div>
            <Label htmlFor={id}>{f.label}</Label>
            {help}
          </div>
        </div>
      );
    case 'select':
      return (
        <div>
          <Label htmlFor={id}>{f.label}</Label>
          <Select id={id} name={f.key} defaultValue={typeof value === 'string' ? value : f.default} className="w-full">
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {help}
        </div>
      );
    case 'text':
      return (
        <div className="sm:col-span-2 xl:col-span-3">
          <Label htmlFor={id}>{f.label}</Label>
          {/*
            A sign-off is two lines. Put one in an <input> and the browser
            strips the break on the way in and on the way out, so what he saved
            went out as "Best,Maor".
          */}
          {f.multiline ? (
            <Textarea
              id={id}
              name={f.key}
              rows={2}
              defaultValue={typeof value === 'string' ? value : f.default}
              placeholder={f.placeholder}
            />
          ) : (
            <Input id={id} name={f.key} defaultValue={typeof value === 'string' ? value : f.default} placeholder={f.placeholder} />
          )}
          {help}
        </div>
      );
    case 'multi': {
      const chosen = new Set(Array.isArray(value) ? value : f.default);
      return (
        <div className="sm:col-span-2 xl:col-span-3">
          <Label htmlFor={id}>{f.label}</Label>
          <div id={id} className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {f.options.map((o) => (
              <label key={o.value} className="inline-flex items-center gap-1.5 text-[13px] text-neutral-700">
                <input type="checkbox" name={f.key} value={o.value} defaultChecked={chosen.has(o.value)} className="h-4 w-4" />
                {o.label}
              </label>
            ))}
          </div>
          {help}
        </div>
      );
    }
  }
}
