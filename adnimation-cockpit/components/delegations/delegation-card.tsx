'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useUndo } from '@/components/ui/undo-bar';
import {
  archiveDelegationAction, nudgeAction, readConversationAction, replyAction, setStatusAction,
} from '@/app/actions/delegations';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import type { DelegationRow } from '@/lib/delegation/module';
import type { ThreadMessage } from '@/lib/integrations/types';
import { fmtDateTime } from '@/lib/utils';

const STATUS_LABEL: Record<string, string> = {
  sent: 'SENT',
  acknowledged: 'ACKNOWLEDGED',
  in_progress: 'IN PROGRESS',
  stale: 'STUCK',
  done: 'DONE',
};

const STATUSES = ['sent', 'acknowledged', 'in_progress', 'done'] as const;

/**
 * One hand-off, and everything he does to it.
 *
 * The conversation is fetched only when he opens it: a page of delegations
 * would otherwise be a page of Slack calls, most of them for threads he is not
 * reading. Once open it is the real thread, not a stored copy — replies made in
 * Slack appear here without anything having to sync them.
 */
export function DelegationCard({ delegation }: { delegation: DelegationRow }) {
  const d = delegation;
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<ThreadMessage[] | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [closing, setClosing] = useState(false);
  const router = useRouter();
  const undo = useUndo();

  useEffect(() => {
    if (!open || thread !== null || loading) return;
    setLoading(true);
    readConversationAction(d.id)
      .then((r) => {
        setThread(r.messages);
        setThreadError(r.error);
      })
      .catch(() => setThreadError('Could not reach Slack'))
      .finally(() => setLoading(false));
  }, [open, thread, loading, d.id]);

  const run = (action: (f: FormData) => Promise<{ ok: boolean; error?: string }>, data: FormData) =>
    startTransition(async () => {
      const result = await action(data);
      setMessage(result.ok ? null : (result.error ?? 'That did not work'));
      if (result.ok) {
        setThread(null);
        undo.offer();
        router.refresh();
      }
    });

  const send = (form: HTMLFormElement, action: typeof replyAction) => {
    const data = new FormData(form);
    data.set('id', d.id);
    run(action, data);
    form.reset();
  };

  return (
    <li className="border-t border-line px-[18px] py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-cond text-[17px] leading-none text-neutral-900">{d.title}</p>
            <Tag tone={d.status === 'done' ? 'ok' : d.stuck ? 'warning' : 'neutral'}>
              {STATUS_LABEL[d.status] ?? d.status}
            </Tag>
            {d.replyAt ? (
              <Tag tone="ok">{d.replyChannel === 'email' ? 'ANSWERED BY EMAIL' : 'ANSWERED'}</Tag>
            ) : null}
            {d.undelivered ? (
              <Tag tone="critical" title="Slack never accepted this — nobody was told">
                Not delivered
              </Tag>
            ) : null}
            {d.nudgeCount > 0 ? (
              <Tag tone="outline">
                Chased <Num>{d.nudgeCount}</Num>×
              </Tag>
            ) : null}
          </div>

          <p className="hud-label mt-1 whitespace-normal text-[11px]">
            {d.slackShared ? 'SLACK THREAD WITH' : 'SLACK DM TO'} {d.personName} · HANDED OVER{' '}
            <Num>{fmtDateTime(d.delegatedAt)}</Num>
            {d.dueDate ? (
              <>
                {' '}
                · DUE <Num>{d.dueDate}</Num>
              </>
            ) : null}
            {' '}· {d.priority}
          </p>

          {d.note ? <p className="mt-1 text-[13px] text-neutral-600">{d.note}</p> : null}

          {d.replyExcerpt ? (
            <p className="mt-1.5 border-s-2 border-accent ps-2 text-[13px] text-neutral-700">
              {d.replyExcerpt.slice(0, 200)}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-start gap-5">
          <div className="text-end">
            <span className="hud-label block text-[11px]">Quiet</span>
            <span
              className={`font-cond text-[19px] leading-none ${
                d.stuck ? 'text-sev-warning' : 'text-neutral-900'
              }`}
            >
              <Num>{d.daysQuiet}d</Num>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="xs" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? 'CLOSE' : 'CONVERSATION'}
        </Button>

        {d.status !== 'done' ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              const data = new FormData();
              data.set('id', d.id);
              run(nudgeAction, data);
            }}
          >
            Chase
          </Button>
        ) : null}

        <label className="sr-only" htmlFor={`status-${d.id}`}>
          Status
        </label>
        <Select
          id={`status-${d.id}`}
          value={d.status}
          disabled={pending}
          className="h-9 text-[13.5px]"
          onChange={(e) => {
            if (e.target.value === 'done') {
              setClosing(true);
              return;
            }
            const data = new FormData();
            data.set('id', d.id);
            data.set('status', e.target.value);
            run(setStatusAction, data);
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>

        {d.slackMessageUrl ? (
          <a
            href={d.slackMessageUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semi text-[11.5px] uppercase tracking-[0.14em] text-info hover:underline"
          >
            Slack ↗
          </a>
        ) : null}
        {d.clickupTaskId ? (
          <a
            href={`https://app.clickup.com/t/${d.clickupTaskId}`}
            target="_blank"
            rel="noreferrer"
            className="font-semi text-[11.5px] uppercase tracking-[0.14em] text-info hover:underline"
          >
            ClickUp ↗
          </a>
        ) : null}

        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            const data = new FormData();
            data.set('id', d.id);
            run(archiveDelegationAction, data);
          }}
        >
          Archive
        </Button>

        {message ? <span className="text-2xs text-destructive">{message}</span> : null}
      </div>

      {closing ? (
        <form
          className="mt-2 flex flex-wrap items-center gap-2 border border-line p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            data.set('id', d.id);
            data.set('status', 'done');
            run(setStatusAction, data);
            setClosing(false);
          }}
        >
          <Input
            name="closedNote"
            placeholder="How did it end? (optional)"
            className="min-w-0 flex-1"
          />
          <Button type="submit" size="sm" disabled={pending}>
            Mark done
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setClosing(false)}>
            Cancel
          </Button>
        </form>
      ) : null}

      {open ? (
        <div className="mt-2 border border-line p-2">
          {loading ? (
            <p className="font-semi text-[11px] tracking-[0.12em] text-neutral-500">
              Reading the thread…
            </p>
          ) : threadError ? (
            <p className="font-semi text-[11px] text-sev-warning">{threadError}</p>
          ) : thread && thread.length > 0 ? (
            <ul className="space-y-2">
              {thread.map((m) => (
                <li key={m.ts} className={m.fromCockpit ? 'ps-0' : 'ps-4'}>
                  <p className="hud-label text-[11px]">
                    {m.authorName} · <Num>{fmtDateTime(m.at)}</Num>
                  </p>
                  <p className="whitespace-pre-wrap text-[13px] text-neutral-700">{m.text}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-semi text-[11px] text-neutral-500">Nothing in this thread yet.</p>
          )}

          {!threadError ? (
            <form
              className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(e.currentTarget, replyAction);
              }}
            >
              <label className="sr-only" htmlFor={`reply-${d.id}`}>
                Reply in the thread
              </label>
              <Textarea
                id={`reply-${d.id}`}
                name="text"
                rows={2}
                required
                placeholder={`Reply to ${d.personName} in Slack`}
                className="min-w-0 flex-1"
              />
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? 'SENDING…' : 'SEND'}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
