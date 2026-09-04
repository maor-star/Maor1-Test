'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  runAgentAction, setAutonomyAction, setInstructionsAction, setNotifyAction, setProfileAction,
  setScheduleAction, toggleAgentAction, trainAgentAction,
} from '@/app/actions/agents';
import { Button } from '@/components/ui/button';
import { Label, Select, Textarea } from '@/components/ui/input';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import {
  AUTONOMY_LABEL, PROMOTION_MIN_RUNS, RUN_INTERVALS, isIrreversible,
} from '@/lib/agents/types';
import { botFor } from '@/lib/agents/slack-bots';
import { summarise } from '@/lib/agents/summarise-run';
import type { AgentListItem } from '@/lib/agents/module';
import { fmtDateTime } from '@/lib/utils';
import { AgentSettingsForm } from '@/components/agents/settings-form';
import { AgentPlaybook } from '@/components/agents/playbook';

/**
 * What a brief for this particular agent might say.
 *
 * A blank box with a generic example gets a generic brief. The corrections
 * that matter are the ones only he knows, so the placeholder asks for those,
 * in the terms of the job that agent actually does.
 */
/**
 * What a playbook for this agent would actually contain.
 *
 * A blank sixteen-line box is a box nobody fills. The placeholder is the
 * shape of the answer, per agent, so the first thing he sees is what a good
 * one looks like rather than an invitation to invent a format.
 */
const PLAYBOOK_HINTS: Record<string, string> = {
  default:
    'The whole job, in your words. For example:\n\n' +
    'WHAT THIS IS FOR\n' +
    'One paragraph: what you want it to achieve, and what would count as it doing well.\n\n' +
    'WHAT COUNTS\n' +
    '· The cases it should act on, named specifically.\n\n' +
    'WHAT NEVER COUNTS\n' +
    '· The cases it must leave alone, however tempting.\n\n' +
    'HOW TO SAY IT\n' +
    '· Tone, length, and the words you do and do not use.\n\n' +
    'WHEN IN DOUBT\n' +
    '· What to do when none of the above fits.',
  'meeting-booker':
    'WHO I MEET\n' +
    '· Partners, publishers, people I am already talking to.\n' +
    '· Anyone inside Adnimation, always.\n\n' +
    'WHO I NEVER MEET\n' +
    '· Cold outreach, however polite. No reply at all — do not even ask me.\n\n' +
    'WHEN TO ASK ME FIRST\n' +
    '· Anything in the evening or at a weekend.\n' +
    '· Anyone you are not sure about — tell me who they are and what it is about.\n\n' +
    'HOW TO WRITE IT\n' +
    '· Short. Three times, the link, nothing else. Never say what the meeting is about.\n' +
    '· In my voice and my manners — paste two replies of mine here if you want it closer.',
  'marketing-writer':
    'HOW I SOUND\n' +
    'Paste in two or three posts of mine that worked. That is the strongest instruction there is.\n\n' +
    'WHAT I POST ABOUT\n' +
    '· A partner going live, a signature, a product we shipped, a number of ours that is public.\n\n' +
    'WHAT I NEVER POST\n' +
    '· Revenue, CPMs, rev share, anything from inside a contract.\n' +
    '· A client name before they have said it themselves.\n\n' +
    'HOW IT READS\n' +
    '· First line is the whole point. Short paragraphs. No “thrilled to announce”.\n\n' +
    'WHEN IN DOUBT\n' +
    '· Write the smaller true post, not the bigger one.',
  autopilot:
    'HOW I RUN THE COMPANY\n' +
    'What I look at first in the morning, and why. Which numbers matter and which are noise.\n\n' +
    'WHAT I WANT TOLD IMMEDIATELY\n' +
    '· A core client down more than 20% week over week.\n' +
    '· Anything that threatens a contract or a renewal.\n\n' +
    'WHAT CAN WAIT FOR THE WEEKLY\n' +
    '· Small movements on small lines. Housekeeping.\n\n' +
    'HOW I DECIDE\n' +
    '· Protect existing revenue before chasing new revenue.\n' +
    '· Never surprise a partner. Never let a signed contract sit unintegrated.\n\n' +
    'WHO DOES WHAT\n' +
    '· Names, and what each of them owns.',
  'core-client-guardian':
    'WHO THE CORE CLIENTS ARE\n' +
    'Name them, and say what each is worth to us and who owns the relationship.\n\n' +
    'WHAT A REAL DROP LOOKS LIKE\n' +
    '· Seasonality I already know about, so you do not flag it every year.\n\n' +
    'WHAT TO DO ABOUT ONE\n' +
    '· Who to write to, what to check first, what never to say.',
  'contract-redliner':
    'OUR STANDING POSITIONS\n' +
    'Payment terms, notice, liability, exclusivity, governing law — what we accept and what we never do.\n\n' +
    'WHERE WE HAVE ROOM\n' +
    '· What is worth conceding, and for what in return.\n\n' +
    'HOW WE WORD A PUSHBACK\n' +
    '· The phrasing that has worked, and the phrasing that has not.',
  'mail-answerer':
    'WHAT A SIMPLE MAIL IS\n' +
    'The kinds you are happy for it to answer without you, with examples.\n\n' +
    'WHAT IT NEVER TOUCHES\n' +
    '· Money, contracts, staff, commitments, anyone senior at a partner.\n\n' +
    'HOW I WRITE\n' +
    '· Length, sign-off, and two or three replies of mine worth copying.',
};

const BRIEF_HINTS: Record<string, string> = {
  'mail-answerer':
    'Write it as you would tell a new assistant:\n' +
    '· Never answer anyone from Google or Taboola — those come to me.\n' +
    '· Two sentences, no pleasantries, and never a date I have not given you.\n' +
    '· If they ask for a deck, point them at me rather than sending anything.\n' +
    '· If you are anything less than certain, leave it and tell me why.',
  'invoice-forwarder':
    '· Anything from Elki is a report, never an invoice.\n' +
    '· Gym and personal receipts are mine, not the company’s — leave them.\n' +
    '· Anything above $10,000 comes to me first.',
  'promo-filer':
    '· Never file anything from a publisher I already work with.\n' +
    '· Newsletters I actually read: Adexchanger, Digiday. Leave those.',
  'contract-redliner':
    'Your standing positions, in your words. For example:\n' +
    '· Payment terms: Net 45 or better. Never beyond Net 60.\n' +
    '· No auto-renewal unless the notice period is 30 days or less.\n' +
    '· Liability capped at 12 months of fees. Never uncapped.\n' +
    '· No exclusivity without a revenue commitment in writing.\n' +
    '· Israeli law and Tel Aviv courts where we can get it.',
  'contract-reader':
    '· Always tell me the termination notice period and the payment terms first.\n' +
    '· Flag any exclusivity or auto-renewal clause, however it is worded.',
};

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
  const [preview, setPreview] = useState<string | null>(null);
  const [teaching, setTeaching] = useState(false);
  const [customising, setCustomising] = useState(false);
  const [writingPlaybook, setWritingPlaybook] = useState(false);
  const [editingVoice, setEditingVoice] = useState(false);
  const [openRun, setOpenRun] = useState<number | null>(null);
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

  const run = (
    action: (
      f: FormData,
    ) => Promise<{ ok: boolean; error?: string; message?: string; preview?: string }>,
    data: FormData,
  ) =>
    startTransition(async () => {
      const result = await action(data);
      setMessage(result.ok ? (result.message ?? null) : (result.error ?? 'That did not work'));
      // A dry run's whole value is the detail, so it stays on screen until he
      // closes it rather than flashing past in a status line.
      setPreview(result.preview ?? null);
      router.refresh();
    });

  const withId = (extra: Record<string, string> = {}) => {
    const data = new FormData();
    data.set('id', a.id);
    for (const [k, v] of Object.entries(extra)) data.set(k, v);
    return data;
  };

  return (
    <li className="border-t border-line px-[18px] py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* The name is the way in — the same as a deal or a contact.
                Hunting for the right button to open an agent is the reason
                half of them were never opened. */}
            <button
              type="button"
              onClick={() => {
                const opening = !(customising || teaching || writingPlaybook);
                setCustomising(opening);
                setWritingPlaybook(opening);
                setTeaching(opening);
              }}
              className="text-start font-cond text-[17px] leading-none text-neutral-900 hover:text-accent"
              title="Open it: its playbook, its brief and its dials"
            >
              {a.name}
            </button>
            <Tag tone={a.enabled ? 'ok' : 'neutral'}>{a.enabled ? 'ON' : 'OFF'}</Tag>
            <Tag tone="outline">LEVEL {a.autonomyLevel}</Tag>
            {irreversible.length > 0 ? (
              <Tag
                tone="critical"
                title={`Holds ${irreversible.map((x) => x.type).join(', ')} — can never run silently`}
              >
                Irreversible
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

          <p className="hud-label mt-1.5 whitespace-normal text-[11px]">
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
          <span className="hud-label block text-[11px]">Today</span>
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
          title="Run it against your real mail, message by message, sending and filing nothing"
          onClick={() => run(runAgentAction, withId({ dryRun: '1' }))}
        >
          {pending ? 'READING YOUR MAIL…' : 'DRY RUN'}
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
              ? `${botFor(a.name).username} tells you in Slack after every run. Click to silence.`
              : `Silent unless it halts. Click to have ${botFor(a.name).username} report in Slack.`
          }
          onClick={() => run(setNotifyAction, withId({ on: a.notifySlack ? '0' : '1' }))}
        >
          {a.notifySlack ? `SLACK: ${botFor(a.name).username.toUpperCase()}` : 'SLACK: OFF'}
        </Button>

        {a.name === 'mail-answerer' ? (
          <Button
            type="button"
            size="xs"
            variant={a.learning?.profile ? 'outline' : 'ghost'}
            disabled={pending || a.learning?.running}
            title="Read a year of your own replies and learn how you write"
            onClick={() => run(trainAgentAction, withId({ days: '365' }))}
          >
            {a.learning?.running
              ? 'READING YOUR MAIL…'
              : a.learning?.profile
                ? 'TRAIN AGAIN'
                : 'LEARN HOW YOU WRITE'}
          </Button>
        ) : null}

        <Button
          type="button"
          size="xs"
          variant={a.instructions ? 'outline' : 'ghost'}
          onClick={() => setTeaching((v) => !v)}
          title="Tell it exactly what to do and what to leave alone"
        >
          {teaching ? 'CLOSE' : a.instructions ? 'EDIT ITS BRIEF' : 'TEACH IT'}
        </Button>

        {/*
          Its dials. The brief is for what nobody anticipated; these are the
          thresholds and switches every run reads directly, so a change here
          is guaranteed to be obeyed rather than interpreted.
        */}
        <Button
          type="button"
          size="xs"
          variant={a.playbook ? 'outline' : 'ghost'}
          onClick={() => setWritingPlaybook((v) => !v)}
          title="The document behind it — how this job is actually done"
        >
          {writingPlaybook ? 'CLOSE' : a.playbook ? 'ITS PLAYBOOK ✓' : 'GIVE IT A PLAYBOOK'}
        </Button>

        {a.settingFields.length > 0 ? (
          <Button
            type="button"
            size="xs"
            variant={Object.keys(a.settings).some((k) => JSON.stringify(a.settings[k]) !== JSON.stringify(a.settingFields.find((f) => f.key === k)?.default)) ? 'outline' : 'ghost'}
            onClick={() => setCustomising((v) => !v)}
            title="Thresholds, windows, scope and channel — read at the top of every run"
          >
            {customising ? 'CLOSE' : 'CUSTOMISE'}
          </Button>
        ) : null}

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

        {/*
          How often it runs. The timers fire often and cheaply; this decides
          whether a firing does anything, so changing an agent's rhythm is a
          click here rather than a deploy.
        */}
        <label className="sr-only" htmlFor={`every-${a.id}`}>
          How often it runs
        </label>
        <Select
          id={`every-${a.id}`}
          value={a.runEveryMinutes ?? 'null'}
          disabled={pending}
          className="h-7 min-w-0 max-w-[16rem] text-[12px]"
          onChange={(e) => run(setScheduleAction, withId({ minutes: e.target.value }))}
        >
          {RUN_INTERVALS.map((i) => (
            <option key={String(i.minutes)} value={i.minutes ?? 'null'}>
              {i.label}
            </option>
          ))}
        </Select>

        {a.lastRanAt ? (
          <span className="font-semi text-[11.5px] tracking-[0.1em] text-neutral-500">
            Last ran <Num>{fmtDateTime(a.lastRanAt)}</Num>
          </span>
        ) : null}

        {!canPromote && a.autonomyLevel === 1 ? (
          <span className="font-semi text-[11.5px] tracking-[0.1em] text-neutral-500">
            <Num>{PROMOTION_MIN_RUNS - a.runCount}</Num> more runs before it can be promoted
          </span>
        ) : null}

        {message ? (
          <span className="font-semi text-[11.5px] tracking-[0.1em] text-info">{message}</span>
        ) : null}
      </div>

      {preview ? (
        <div className="mt-2 border border-line">
          <div className="flex items-center justify-between gap-3 border-b border-line px-2 py-1">
            <span className="hud-label text-[11px]">
              What it would have done — nothing was touched
            </span>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="font-semi text-[11.5px] tracking-[0.14em] text-neutral-500 hover:text-accent"
            >
              Close
            </button>
          </div>
          <pre
            dir="ltr"
            className="max-h-80 overflow-auto whitespace-pre-wrap px-2 py-2 text-start text-[12px] leading-relaxed text-neutral-700"
          >
            {preview}
          </pre>
        </div>
      ) : null}

      {/*
        Every run it has had, and what it printed.
        
        The dry run he pressed an hour ago, and the run the timer did at four
        this morning, are the same question — what did it do with each mail —
        so they are in one list, newest first, and each one opens.
      */}
      {a.jobRuns.length > 0 ? (
        <div className="mt-2 border border-line">
          <div className="border-b border-line px-2 py-1">
            <span className="hud-label text-[11px]">
              What it did, run by run — <Num>{a.jobRuns.length}</Num> Most recent
            </span>
          </div>
          <ul>
            {a.jobRuns.map((r) => (
              <li key={r.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpenRun((v) => (v === r.id ? null : r.id))}
                  className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-2 py-1.5 text-start hover:bg-accent/5"
                >
                  <span className="font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                    <Num>{fmtDateTime(r.startedAt)}</Num>
                  </span>
                  <span
                    className={`font-semi text-[11.5px] tracking-[0.12em] ${
                      r.dry ? 'text-neutral-500' : 'text-info'
                    }`}
                  >
                    {r.dry ? 'DRY RUN' : 'FOR REAL'}
                  </span>
                  <span className="text-[12px] text-neutral-600">{summarise(r)}</span>
                  <span className="ms-auto font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                    {openRun === r.id ? 'CLOSE' : 'OPEN'}
                  </span>
                </button>
                {openRun === r.id ? (
                  <pre
                    dir="ltr"
                    className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-line px-2 py-2 text-start text-[12px] leading-relaxed text-neutral-700"
                  >
                    {r.output || 'It printed nothing.'}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        What it learned, and what it read. Shown next to the brief rather than
        merged into it: one he wrote, the other was inferred from a year of his
        replies, and he needs to be able to tell which is which before he
        trusts a draft.
      */}
      {a.learning && (a.learning.profile || a.learning.error || a.learning.running) ? (
        <div className="mt-2 border border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-2 py-1">
            <span className="hud-label text-[11px]">
              HOW YOU WRITE
              {a.learning.editedByHim ? ' · YOUR WORDS' : ''}
              {a.learning.threadsRead > 0 ? (
                <>
                  {' '}· FROM <Num>{a.learning.threadsRead}</Num> Of your replies
                </>
              ) : null}
              {a.learning.learnedAt ? (
                <>
                  {' '}· <Num>{fmtDateTime(a.learning.learnedAt)}</Num>
                </>
              ) : null}
            </span>
            {a.learning.profile ? (
              <button
                type="button"
                onClick={() => setEditingVoice((v) => !v)}
                className="font-semi text-[11.5px] tracking-[0.14em] text-neutral-500 hover:text-accent"
              >
                {editingVoice ? 'CLOSE' : 'CORRECT IT'}
              </button>
            ) : null}
          </div>

          {a.learning.running ? (
            <p className="px-2 py-2 text-[13px] text-neutral-600">
              Reading your mail. It takes a few minutes — reload to see what it learned.
            </p>
          ) : a.learning.error ? (
            <p className="px-2 py-2 text-[13px] text-sev-warning">{a.learning.error}</p>
          ) : editingVoice ? (
            <form
              className="p-2"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                data.set('id', a.id);
                run(setProfileAction, data);
                setEditingVoice(false);
              }}
            >
              <Textarea
                name="profile"
                rows={10}
                defaultValue={a.learning.profile ?? ''}
                className="w-full"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                  Save
                </Button>
                <span className="font-semi text-[11.5px] tracking-[0.1em] text-neutral-500">
                  Once you edit this it is yours — training will leave it alone. clear it to let it
                  learn again.
                </span>
              </div>
            </form>
          ) : (
            <>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-2 py-2 text-[13px] leading-relaxed text-neutral-700">
                {a.learning.profile}
              </pre>
              {a.learning.facts.medianLength ? (
                <p className="border-t border-line px-2 py-1 font-semi text-[11.5px] tracking-[0.1em] text-neutral-500">
                  Your typical reply is <Num>{a.learning.facts.medianLength}</Num> CHARACTERS ·{' '}
                  <Num>{a.learning.facts.hebrewShare ?? 0}%</Num> have hebrew in them
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {writingPlaybook ? (
        <AgentPlaybook
          agentId={a.id}
          playbook={a.playbook}
          playbookName={a.playbookName}
          updatedAt={a.playbookUpdatedAt}
          hint={PLAYBOOK_HINTS[a.name] ?? PLAYBOOK_HINTS.default!}
          onClose={() => setWritingPlaybook(false)}
        />
      ) : null}

      {customising ? (
        <AgentSettingsForm
          agentId={a.id}
          fields={a.settingFields}
          values={a.settings}
          onClose={() => setCustomising(false)}
        />
      ) : null}

      {a.instructions && !teaching ? (
        <p className="mt-2 border-s-2 border-accent bg-accent/5 py-1 ps-2 text-[13px] whitespace-pre-wrap text-neutral-700">
          {a.instructions}
        </p>
      ) : null}

      {teaching ? (
        <form
          className="mt-2 border border-line p-2"
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
              BRIEF_HINTS[a.name] ??
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
              Save the brief
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setTeaching(false)}>
              Cancel
            </Button>
            <span className="font-semi text-[11.5px] tracking-[0.1em] text-neutral-500">
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
