'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/input';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import {
  draftItemAction, handOverAction, keepItemAction, sendItemAction, skipItemAction,
} from '@/app/actions/desk';
import { actLabel, CHANNEL_LABEL, type DeskChannel, type DeskItem } from '@/lib/copilot/desk-rules';
import type { DeskDraft } from '@/lib/copilot/desk-draft';

/**
 * One thing waiting on him, with the answer already written.
 *
 * The same card the rest of the cockpit uses — who it is with and its state on
 * the first line, the facts on the second, then the thing itself. What is
 * different here is that the thing itself is a draft he can edit and send, and
 * that every button both acts and files the follow-up somewhere he will see it
 * again.
 */

const TONE: Record<DeskChannel, 'critical' | 'warning' | 'watch' | 'outline' | 'neutral'> = {
  contract: 'critical',
  mail: 'warning',
  slack: 'warning',
  delegation: 'watch',
  deal: 'outline',
  task: 'neutral',
};

export function DeskCard({
  item,
  draft,
  stale,
  team,
}: {
  item: DeskItem;
  /** What was prepared for it, if anything has been. */
  draft: DeskDraft | null;
  /** True when the draft was written before the conversation moved on. */
  stale: boolean;
  team: { id: string; label: string }[];
}) {
  const [text, setText] = useState(draft?.text ?? '');
  const [current, setCurrent] = useState<DeskDraft | null>(draft);
  const [handing, setHanding] = useState(false);
  const [person, setPerson] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (work: () => Promise<{ ok: boolean; error?: string; did?: string }>) =>
    startTransition(async () => {
      const result = await work();
      setMessage(result.ok ? null : (result.error ?? 'That did not work'));
      if (result.ok) {
        setDone(result.did ?? 'Done.');
        router.refresh();
      }
    });

  const draftIt = () =>
    startTransition(async () => {
      const result = await draftItemAction(item.id);
      if (result.ok && result.draft) {
        setCurrent(result.draft);
        setText(result.draft.text);
        setMessage(null);
      } else {
        setMessage(result.error ?? 'Could not draft it');
      }
    });

  const form = (extra: Record<string, string> = {}) => {
    const data = new FormData();
    data.set('itemId', item.id);
    data.set('text', text);
    for (const [k, v] of Object.entries(extra)) data.set(k, v);
    return data;
  };

  return (
    <li className="border-t border-line px-[18px] py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-semibold leading-none text-ink">{item.who}</span>
            <Tag tone={TONE[item.channel]}>{CHANNEL_LABEL[item.channel]}</Tag>
            {current?.verdict ? (
              <Tag tone={current.verdict.ok ? 'ok' : 'critical'}>
                {current.verdict.ok ? 'Reads fine' : 'Argue with this'}
              </Tag>
            ) : null}
            {current && stale ? (
              <Tag tone="warning" title="It moved on after this was written">
                They have written since
              </Tag>
            ) : null}
            {current ? (
              <Tag tone="outline" title="How sure the copilot is">
                {current.confidence.toUpperCase()}
              </Tag>
            ) : null}
          </div>

          <p className="mt-1 text-[13.5px] text-neutral-700">{item.title}</p>
          {item.context ? (
            <p className="mt-1 whitespace-pre-line text-[12.5px] text-muted">{item.context}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-start gap-5">
          <div className="text-end">
            <span className="hud-label block text-[11.5px]">Waiting</span>
            <span
              className={`font-mono text-[19px] font-semibold leading-none ${
                item.waitingDays >= 7 ? 'text-warn' : 'text-ink'
              }`}
            >
              <Num>{`${item.waitingDays}d`}</Num>
            </span>
          </div>
          {item.url ? (
            <a
              href={item.url}
              target={item.url.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
              className="hud-label text-[11.5px] text-info hover:underline"
            >
              Open it ↗
            </a>
          ) : null}
        </div>
      </div>

      {/*
        The briefing, then the recommendation — in that order, because that is
        the order he can judge them in.
        
        He asked for this: a card that opened straight into a suggested reply
        was asking him to trust advice about a conversation he had not read.
        The background is what they said; the recommendation is what to do
        about it; "why" is the reasoning he can disagree with.
      */}
      {current?.background ? (
        <div className="mt-2 rounded-[10px] border border-line bg-neutral-50 p-2.5">
          <span className="hud-label block text-[11px]">What they wrote</span>
          <p className="mt-1 text-[13px] leading-snug text-neutral-800">{current.background}</p>
        </div>
      ) : null}

      {current ? (
        <p className="mt-2 text-[13px] text-neutral-700">
          <span className="hud-label me-1.5 text-[11.5px]">Why this answer</span>
          {current.why}
        </p>
      ) : null}

      {current?.verdict && current.verdict.points.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 border-s-2 border-warn ps-2">
          {current.verdict.points.map((p) => (
            <li key={p} className="text-[13px] text-neutral-700">
              {p}
            </li>
          ))}
        </ul>
      ) : null}

      {current ? (
        <div className="mt-2">
          <label htmlFor={`d-${item.id}`} className="hud-label block text-[11.5px]">
            {item.act === 'send'
              ? 'What I would send — change anything before you do'
              : 'What I would do next'}
          </label>
          <Textarea
            id={`d-${item.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="mt-1"
          />
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-muted">
          Nothing prepared for this one yet.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {current ? (
          <Button
            type="button"
            size="xs"
            disabled={pending || text.trim() === ''}
            onClick={() =>
              run(async () =>
                item.act === 'send' ? sendItemAction(form()) : keepItemAction(form()),
              )
            }
          >
            {pending ? 'WORKING…' : actLabel(item)}
          </Button>
        ) : null}

        <Button type="button" size="xs" variant="outline" disabled={pending} onClick={draftIt}>
          {current ? 'Draft it again' : 'Draft an answer'}
        </Button>

        {item.act === 'send' && current ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={pending}
            title="Keep it as a task instead of answering now"
            onClick={() => run(async () => keepItemAction(form()))}
          >
            Keep it as a task
          </Button>
        ) : null}

        <Button
          type="button"
          size="xs"
          variant={handing ? 'default' : 'ghost'}
          onClick={() => setHanding((v) => !v)}
        >
          {handing ? 'Close' : 'Hand it to someone'}
        </Button>

        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={pending}
          title="Off the desk. Nothing is sent and nothing is filed."
          onClick={() => run(async () => skipItemAction(item.id))}
        >
          Not now
        </Button>

        {done ? <span className="text-[12px] text-pos">{done}</span> : null}
        {message ? <span className="text-[12px] text-neg">{message}</span> : null}
      </div>

      {handing ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-[12px] border border-line p-3">
          <div className="min-w-[12rem]">
            <label htmlFor={`h-${item.id}`} className="hud-label block text-[11.5px]">
              Who is taking it
            </label>
            <Select
              id={`h-${item.id}`}
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              className="mt-1 w-full"
            >
              <option value="">Pick someone</option>
              {team.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={pending || person === ''}
            onClick={() => run(async () => handOverAction(form({ personId: person })))}
          >
            {pending ? 'HANDING IT OVER…' : 'HAND IT OVER'}
          </Button>
          <span className="hud-label text-[11.5px] tracking-[0.1em]">
            They hear about it in Slack, it lands in ClickUp, and it goes on the delegation tracker
            {current?.handTo ? ` · the copilot would send this to ${current.handTo}` : ''}
          </span>
        </div>
      ) : null}
    </li>
  );
}
