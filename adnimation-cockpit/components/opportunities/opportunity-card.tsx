'use client';

import Link from 'next/link';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useUndo } from '@/components/ui/undo-bar';
import {
  archiveOpportunityAction, decideSuggestionAction, promoteAction, setStatusAction,
  updateOpportunityAction,
} from '@/app/actions/opportunities';
import { Button } from '@/components/ui/button';
import { Attachments } from '@/components/attachments';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
// From the pure rules, never from the module: that one owns the database
// connection, and importing it here would pull the driver into the browser.
import {
  KIND_LABEL, KIND_TO_CLIENT_TYPE, OPPORTUNITY_KINDS, OPPORTUNITY_STATUSES, STATUS_LABEL,
  type OpportunityListItem,
} from '@/lib/opportunities/rules';
import { CLIENT_TYPES, CLIENT_TYPE_LABEL, OPEN_STAGES, STAGE_LABEL } from '@/lib/pipeline/types';
import { fmtDateTime, fmtMoney } from '@/lib/utils';

/** The statuses he sets himself; `suggested` is only ever set by the detector. */
const SETTABLE = ['new', 'exploring', 'parked', 'won', 'lost'] as const;

/**
 * One opportunity, and everything he does to it.
 *
 * Editing is inline rather than a page of its own: the whole point of this
 * module is that updating something takes less effort than ignoring it.
 */
export function OpportunityCard({
  opportunity,
  contracts = [],
}: {
  opportunity: OpportunityListItem;
  /** Contracts pointing at this opportunity, so the link is visible from here too. */
  contracts?: { id: string; counterparty: string; status: string; waitingOn: string }[];
}) {
  const o = opportunity;
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  const undo = useUndo();

  const run = (action: (f: FormData) => Promise<{ ok: boolean; error?: string }>, data: FormData) =>
    startTransition(async () => {
      const result = await action(data);
      setMessage(result.ok ? null : (result.error ?? 'That did not work'));
      if (result.ok) {
        setEditing(false);
        setDeciding(false);
        setPromoting(false);
        undo.offer();
        router.refresh();
      }
    });

  const withId = (extra: Record<string, string> = {}) => {
    const data = new FormData();
    data.set('id', o.id);
    for (const [k, v] of Object.entries(extra)) data.set(k, v);
    return data;
  };

  const suggestion = o.status === 'suggested';

  return (
    <li className="border-t border-divider px-[18px] py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-cond text-[17px] leading-none text-neutral-900">{o.title}</p>
            <Tag tone={o.status === 'won' ? 'ok' : o.status === 'lost' ? 'neutral' : 'outline'}>
              {STATUS_LABEL[o.status]}
            </Tag>
            <Tag tone="neutral">{KIND_LABEL[o.kind]}</Tag>
            {o.state.cold ? (
              <Tag tone="warning" title="Open, no next step, and nothing has happened to it">
                GONE COLD
              </Tag>
            ) : null}
            {o.state.dueToRevisit ? <Tag tone="warning">DUE TO REVISIT</Tag> : null}
            {o.state.overdue ? <Tag tone="critical">NEXT STEP OVERDUE</Tag> : null}
            {o.state.needsNextStep && !o.state.cold ? (
              <Tag tone="outline">NO NEXT STEP</Tag>
            ) : null}
            {o.source !== 'manual' ? (
              <Tag tone="neutral">FROM {o.source.toUpperCase()}</Tag>
            ) : null}
          </div>

          <p className="hud-label mt-1 whitespace-normal text-[9px]">
            {o.counterparty ? `${o.counterparty} · ` : ''}
            ADDED <Num>{fmtDateTime(o.createdAt)}</Num>
            {o.nextStep ? (
              <>
                {' '}· NEXT: {o.nextStep}
                {o.nextStepDate ? (
                  <>
                    {' '}BY <Num>{o.nextStepDate}</Num>
                  </>
                ) : null}
              </>
            ) : null}
            {o.status === 'parked' && o.revisitOn ? (
              <>
                {' '}· REVISIT <Num>{o.revisitOn}</Num>
              </>
            ) : null}
          </p>

          {o.note ? <p className="mt-1 text-[13px] text-neutral-600">{o.note}</p> : null}

          {/*
            The contracts pointing at this one. Linking happens on the contract
            — that is where he is standing when he notices the two belong
            together — and until now it showed nowhere else, so from here the
            link he had just made was invisible.
          */}
          {contracts.length > 0 ? (
            <p className="hud-label mt-1 whitespace-normal text-[9px] text-accent-700">
              {contracts.length === 1 ? 'CONTRACT' : 'CONTRACTS'}:{' '}
              {contracts
                .map(
                  (c) =>
                    `${c.counterparty} — ${c.status.replace(/_/g, ' ')}` +
                    (c.waitingOn === 'you'
                      ? ' (waiting on you)'
                      : c.waitingOn === 'them'
                        ? ' (waiting on them)'
                        : ''),
                )
                .join(' · ')}{' '}
              <Link href="/contracts?view=all" className="underline">
                OPEN
              </Link>
            </p>
          ) : null}

          {o.sourceExcerpt ? (
            <p className="mt-1.5 border-s-2 border-accent ps-2 text-[13px] text-neutral-700">
              {o.sourceExcerpt.slice(0, 240)}
            </p>
          ) : null}

          {suggestion && o.detectReasons.length > 0 ? (
            <p className="hud-label mt-1 whitespace-normal text-[9px] text-neutral-500">
              PROPOSED BECAUSE: {o.detectReasons.join(' · ')}
            </p>
          ) : null}

          {o.decidedNote ? (
            <p className="mt-1 text-[13px] text-neutral-500">Outcome: {o.decidedNote}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-start gap-5">
          {o.valueCents !== null ? (
            <div className="text-end">
              <span className="hud-label block text-[9px]">WORTH</span>
              <span className="font-cond text-[19px] leading-none text-neutral-900">
                <Num>{fmtMoney(o.valueCents)}</Num>
              </span>
            </div>
          ) : null}
          <div className="text-end">
            <span className="hud-label block text-[9px]">QUIET</span>
            <span
              className={`font-cond text-[19px] leading-none ${
                o.state.cold ? 'text-sev-warning' : 'text-neutral-900'
              }`}
            >
              <Num>{o.state.daysQuiet}d</Num>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {suggestion ? (
          <>
            <Button
              type="button"
              size="xs"
              disabled={pending}
              onClick={() => run(decideSuggestionAction, withId({ accept: '1' }))}
            >
              YES, IT IS ONE
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={pending}
              onClick={() => run(decideSuggestionAction, withId({ accept: '0' }))}
            >
              NOT AN OPPORTUNITY
            </Button>

            {/*
              A suggestion arrives named after the email it came from, which is
              a subject line and not what the opportunity is. Renaming it was
              only possible after accepting it — so the pile filled with
              "Re: FW: quick question".
            */}
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? 'CLOSE' : 'NAME IT'}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? 'CLOSE' : 'EDIT'}
            </Button>

            <label className="sr-only" htmlFor={`status-${o.id}`}>
              Status
            </label>
            <Select
              id={`status-${o.id}`}
              value={o.status}
              disabled={pending}
              className="h-7 text-[12px]"
              onChange={(e) => {
                const next = e.target.value;
                if (next === 'won' || next === 'lost') {
                  setDeciding(true);
                  return;
                }
                run(setStatusAction, withId({ status: next }));
              }}
            >
              {SETTABLE.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </>
        )}

        {!suggestion && o.pipelineClientId === null && o.status !== 'lost' ? (
          <Button
            type="button"
            size="xs"
            disabled={pending}
            onClick={() => setPromoting((v) => !v)}
            title="It is a real deal now — move it into the pipeline"
          >
            → PIPELINE
          </Button>
        ) : null}

        {o.pipelineClientId ? (
          <a
            href="/pipeline"
            className="font-semi text-[10px] uppercase tracking-[0.14em] text-accent-700 hover:text-accent"
          >
            In the pipeline ↗
          </a>
        ) : null}

        {/*
          An opportunity captured from a mail was usually captured because of
          what was attached to it — the deck, the rate card, the draft.
        */}
        {o.source === 'mail' ? <Attachments kind="opportunity" id={o.id} /> : null}

        {o.sourceUrl ? (
          <a
            href={o.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semi text-[10px] uppercase tracking-[0.14em] text-accent-700 hover:text-accent"
          >
            {o.source === 'mail' ? 'Open in Gmail ↗' : 'Open in Slack ↗'}
          </a>
        ) : null}

        {!suggestion ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => run(archiveOpportunityAction, withId())}
          >
            ARCHIVE
          </Button>
        ) : null}

        {message ? <span className="text-2xs text-destructive">{message}</span> : null}
      </div>

      {deciding ? (
        <form
          className="mt-2 flex flex-wrap items-center gap-2 border border-divider p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            data.set('id', o.id);
            run(setStatusAction, data);
          }}
        >
          <Select name="status" defaultValue="won" className="h-8 text-[12px]">
            <option value="won">TAKEN</option>
            <option value="lost">MISSED</option>
          </Select>
          <Input
            name="decidedNote"
            placeholder="What happened? (optional)"
            className="min-w-0 flex-1"
          />
          <Button type="submit" size="sm" disabled={pending}>
            RECORD IT
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setDeciding(false)}>
            CANCEL
          </Button>
        </form>
      ) : null}

      {promoting ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 border border-divider p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            data.set('id', o.id);
            run(promoteAction, data);
          }}
        >
          <div>
            <Label htmlFor={`stage-${o.id}`}>Starting stage</Label>
            <Select id={`stage-${o.id}`} name="stage" defaultValue="open_new" className="h-8 text-[12px]">
              {OPEN_STAGES.map((st) => (
                <option key={st} value={st}>
                  {STAGE_LABEL[st]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`ct-${o.id}`}>Which side</Label>
            <Select
              id={`ct-${o.id}`}
              name="clientType"
              defaultValue={KIND_TO_CLIENT_TYPE[o.kind]}
              className="h-8 text-[12px]"
            >
              {CLIENT_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {CLIENT_TYPE_LABEL[ct]}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'MOVING…' : 'MOVE IT'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPromoting(false)}>
            CANCEL
          </Button>
          <span className="pb-1.5 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
            {o.counterparty
              ? `CREATES “${o.counterparty}” IN THE PIPELINE`
              : 'ADD A COUNTERPARTY FIRST — THE PIPELINE NEEDS A NAME'}
          </span>
        </form>
      ) : null}

      {editing ? (
        <form
          className="mt-2 border border-divider p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            data.set('id', o.id);
            // A suggestion keeps its status while being named: naming it is
            // not the same as deciding it is real, so the form does not offer
            // to change it until he has accepted or declined the suggestion.
            if (suggestion) data.set('status', o.status);
            run(updateOpportunityAction, data);
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="sm:col-span-2">
              <Label htmlFor={`t-${o.id}`}>Name</Label>
              <Input id={`t-${o.id}`} name="title" defaultValue={o.title} required />
            </div>
            {/*
              The status belongs in the form as well as on the buttons. WON and
              LOST still stamp the decision either way — see updateOpportunity —
              so moving one here is the same move, not a second kind of it.
            */}
            {!suggestion ? (
              <div>
                <Label htmlFor={`st-${o.id}`}>Status</Label>
                <Select id={`st-${o.id}`} name="status" defaultValue={o.status} className="w-full">
                  {OPPORTUNITY_STATUSES.filter((s) => s !== 'suggested').map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div>
              <Label htmlFor={`k-${o.id}`}>Kind</Label>
              <Select id={`k-${o.id}`} name="kind" defaultValue={o.kind} className="w-full">
                {OPPORTUNITY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`v-${o.id}`}>Worth roughly</Label>
              <Input
                id={`v-${o.id}`}
                name="value"
                defaultValue={o.valueCents !== null ? String(o.valueCents / 100) : ''}
                placeholder="50k"
              />
            </div>
            <div>
              <Label htmlFor={`c-${o.id}`}>Who with</Label>
              <Input id={`c-${o.id}`} name="counterparty" defaultValue={o.counterparty ?? ''} />
            </div>
            <div>
              <Label htmlFor={`n-${o.id}`}>Next step</Label>
              <Input id={`n-${o.id}`} name="nextStep" defaultValue={o.nextStep ?? ''} />
            </div>
            <div>
              <Label htmlFor={`nd-${o.id}`}>By when</Label>
              <Input
                id={`nd-${o.id}`}
                name="nextStepDate"
                type="date"
                defaultValue={o.nextStepDate ?? ''}
              />
            </div>
            <div>
              <Label htmlFor={`r-${o.id}`}>Revisit on (if parked)</Label>
              <Input id={`r-${o.id}`} name="revisitOn" type="date" defaultValue={o.revisitOn ?? ''} />
            </div>
            <div className="sm:col-span-2 xl:col-span-4">
              <Label htmlFor={`no-${o.id}`}>Detail</Label>
              <Textarea id={`no-${o.id}`} name="note" rows={2} defaultValue={o.note ?? ''} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'SAVING…' : 'SAVE'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              CANCEL
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
