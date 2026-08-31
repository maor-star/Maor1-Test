'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  runAgentAction, setAutonomyAction, setInstructionsAction, setNotifyAction, toggleAgentAction,
} from '@/app/actions/agents';
import { Button } from '@/components/ui/button';
import { Label, Select, Textarea } from '@/components/ui/input';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { AUTONOMY_LABEL, PROMOTION_MIN_RUNS, isIrreversible } from '@/lib/agents/types';
import type { AgentListItem } from '@/lib/agents/module';
import { fmtDateTime } from '@/lib/utils';

/**
 * One agent, and the controls that keep it in its box.
 *
 * The autonomy select is the most consequential thing on the page, so it says
 * what each level means rather than showing a number, and the levels an agent
 * is not allowed to have are absent rather than rejected after the click.
 */
export function AgentCard({ agent }: { agent: AgentListItem }) {
  const a = agent;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [teaching, setTeaching] = useState(false);
  const router = useRouter();

  const irreversible = a.actions.filter((x) => isIrreversible(x.type));
  const canPromote = a.runCount >= PROMOTION_MIN_RUNS;

  // Level 4 never appears for an agent that can do something irreversible, and
  // promotion is not offered until it has been earned.
  const levels = [1, 2, 3, 4].filter((level) => {
    if (level === 4 && irreversible.length > 0) return false;
    if (level > a.autonomyLevel && !canPromote) return false;
    return true;
  });

  const run = (action: (f: FormData) => Promise<{ ok: boolean; error?: string; message?: string }>, data: FormData) =>
    startTransition(async () => {
      const result = await action(data);
      setMessage(result.ok ? (result.message ?? null) : (result.error ?? 'That did not work'));
      router.refresh();
    });

  const withId = (extra: Record<string, string> = {}) => {
    const data = new FormData();
    data.set('id', a.id);
    for (const [k, v] of Object.entries(extra)) data.set(k, v);
    return data;
  };

  return (
    <li className="border-t border-divider px-[18px] py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-cond text-[17px] leading-none text-neutral-900">{a.name}</p>
            <Tag tone={a.enabled ? 'ok' : 'neutral'}>{a.enabled ? 'ON' : 'OFF'}</Tag>
            <Tag tone="outline">LEVEL {a.autonomyLevel}</Tag>
            {irreversible.length > 0 ? (
              <Tag
                tone="critical"
                title={`Holds ${irreversible.map((x) => x.type).join(', ')} — can never run silently`}
              >
                IRREVERSIBLE
              </Tag>
            ) : null}
          </div>

          {a.description ? (
            <p className="mt-1 text-[13px] text-neutral-600">{a.description}</p>
          ) : null}
          {a.rationale ? (
            <p className="mt-1 border-s-2 border-accent ps-2 text-[13px] text-neutral-500">
              {a.rationale}
            </p>
          ) : null}

          <p className="hud-label mt-1.5 whitespace-normal text-[9px]">
            {a.triggerType.toUpperCase()}
            {typeof a.triggerConfig.cron === 'string' ? ` · ${a.triggerConfig.cron}` : ''}
            {typeof a.triggerConfig.event === 'string' ? ` · ${a.triggerConfig.event}` : ''}
            {' '}· <Num>{a.conditions.length}</Num> CHECKS ·{' '}
            <Num>{a.actions.length}</Num> ACTIONS · MAX <Num>{a.maxRunsPerHour}</Num>/H
            {' '}· <Num>{a.runCount}</Num> RUNS
            {a.lastRun ? (
              <>
                {' '}· LAST <Num>{fmtDateTime(a.lastRun.startedAt)}</Num>
                {a.lastRun.outcome ? ` (${a.lastRun.outcome})` : ''}
              </>
            ) : ' · NEVER RUN'}
          </p>

          {a.lastRun?.haltReason ? (
            <p className="mt-1 text-[12px] text-sev-warning">Last halt: {a.lastRun.haltReason}</p>
          ) : null}
        </div>

        <div className="shrink-0 text-end">
          <span className="hud-label block text-[9px]">TODAY</span>
          <span className="font-cond text-[19px] leading-none text-neutral-900">
            <Num>{a.runsToday}</Num>
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="xs"
          variant={a.enabled ? 'ghost' : 'default'}
          disabled={pending}
          onClick={() => run(toggleAgentAction, withId({ enabled: a.enabled ? '0' : '1' }))}
        >
          {a.enabled ? 'SWITCH OFF' : 'SWITCH ON'}
        </Button>

        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={pending}
          title="Run it against real data with every side effect stubbed"
          onClick={() => run(runAgentAction, withId({ dryRun: '1' }))}
        >
          DRY RUN
        </Button>

        {/*
          Teaching it. The corrections that matter are the ones nobody could
          have anticipated, so this is free text rather than a form of the
          options we thought of.
        */}
        {/*
          Per agent, and off by default. A notification for every action is a
          notification he stops reading — and an agent he has stopped reading
          about is worse than a silent one, because he thinks he is watching it.
          A halt always speaks, whatever this says.
        */}
        <Button
          type="button"
          size="xs"
          variant={a.notifySlack ? 'outline' : 'ghost'}
          disabled={pending}
          title={
            a.notifySlack
              ? 'Telling you in Slack after every run. Click to silence.'
              : 'Silent unless it halts. Click to have it report in Slack.'
          }
          onClick={() => run(setNotifyAction, withId({ on: a.notifySlack ? '0' : '1' }))}
        >
          {a.notifySlack ? 'SLACK: ON' : 'SLACK: OFF'}
        </Button>

        <Button
          type="button"
          size="xs"
          variant={a.instructions ? 'outline' : 'ghost'}
          onClick={() => setTeaching((v) => !v)}
          title="Tell it exactly what to do and what to leave alone"
        >
          {teaching ? 'CLOSE' : a.instructions ? 'EDIT ITS BRIEF' : 'TEACH IT'}
        </Button>

        <label className="sr-only" htmlFor={`lvl-${a.id}`}>
          Autonomy
        </label>
        <Select
          id={`lvl-${a.id}`}
          value={a.autonomyLevel}
          disabled={pending}
          className="h-7 min-w-0 max-w-[22rem] text-[12px]"
          onChange={(e) => run(setAutonomyAction, withId({ level: e.target.value }))}
        >
          {levels.map((level) => (
            <option key={level} value={level}>
              {level} — {AUTONOMY_LABEL[level]}
            </option>
          ))}
        </Select>

        {!canPromote && a.autonomyLevel === 1 ? (
          <span className="font-semi text-[10px] tracking-[0.1em] text-neutral-500">
            <Num>{PROMOTION_MIN_RUNS - a.runCount}</Num> MORE RUNS BEFORE IT CAN BE PROMOTED
          </span>
        ) : null}

        {message ? (
          <span className="font-semi text-[10px] tracking-[0.1em] text-accent-700">{message}</span>
        ) : null}
      </div>

      {a.instructions && !teaching ? (
        <p className="mt-2 border-s-2 border-accent bg-accent/5 py-1 ps-2 text-[13px] whitespace-pre-wrap text-neutral-700">
          {a.instructions}
        </p>
      ) : null}

      {teaching ? (
        <form
          className="mt-2 border border-divider p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            data.set('id', a.id);
            run(setInstructionsAction, data);
            setTeaching(false);
          }}
        >
          <Label htmlFor={`ins-${a.id}`}>
            What should it do, and what should it leave alone?
          </Label>
          <Textarea
            id={`ins-${a.id}`}
            name="instructions"
            rows={6}
            defaultValue={a.instructions ?? ''}
            placeholder={
              'Write it as you would tell a new assistant. For example:\n' +
              '· Anything from Elki is never an invoice, it is a report.\n' +
              '· Gym and personal receipts are mine, not the company’s — leave them.\n' +
              '· Keep drafts to three sentences, no pleasantries.\n' +
              '· If you are not sure, do nothing and tell me why.'
            }
            className="w-full"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              SAVE THE BRIEF
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setTeaching(false)}>
              CANCEL
            </Button>
            <span className="font-semi text-[10px] tracking-[0.1em] text-neutral-500">
              THIS GOES TO THE AGENT AS ITS OWN INSTRUCTIONS, NOT AS A FILTER ON WHAT IT PRODUCES
              {a.instructionsUpdatedAt ? (
                <>
                  {' '}· LAST TAUGHT <Num>{fmtDateTime(a.instructionsUpdatedAt)}</Num>
                </>
              ) : null}
            </span>
          </div>
        </form>
      ) : null}
    </li>
  );
}
