'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ToPipeline } from '@/components/mail/to-pipeline';
import { useRouter } from 'next/navigation';
import { useUndo } from '@/components/ui/undo-bar';
import { dismissThreadAction, taskFromMailAction, replyAction } from '@/app/actions/mail';
import { captureMailAction } from '@/app/actions/opportunities';
import { Button } from '@/components/ui/button';
import { Attachments } from '@/components/attachments';
import { Textarea } from '@/components/ui/input';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import type { MailRow } from '@/lib/mail/service';
import { fmtDateTime } from '@/lib/utils';

/**
 * One conversation.
 *
 * Opening it goes to Gmail rather than rendering the mail here: the cockpit
 * cannot reply, and a read-only copy of a thread he would then have to answer
 * somewhere else is a dead end. What the cockpit adds is knowing it is waiting
 * at all.
 */
export function ThreadRow({ thread }: { thread: MailRow }) {
  const t = thread;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [sent, setSent] = useState(false);
  const router = useRouter();
  const undo = useUndo();

  const dismissed = t.dismissedAt !== null;
  const stale = !t.lastFromMe && t.daysWaiting >= 3;

  return (
    <li className="border-t border-line px-[18px] py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={t.url}
              target="_blank"
              rel="noreferrer"
              className="font-cond text-[16px] leading-none text-neutral-900 hover:text-accent"
            >
              {t.subject || '(no subject)'}
            </a>
            {t.knownCompany ? <Tag tone="accent">{t.knownCompany}</Tag> : null}
            {t.unread ? <Tag tone="outline">Unread</Tag> : null}
            {t.starred ? <Tag tone="outline">Starred</Tag> : null}
            {dismissed ? <Tag tone="neutral">Handled</Tag> : null}
          </div>

          <p className="hud-label mt-1 whitespace-normal text-[11px]">
            {t.counterpartName || t.counterpartEmail || 'UNKNOWN'}
            {t.counterpartName && t.counterpartEmail ? ` · ${t.counterpartEmail}` : ''} ·{' '}
            <Num>{fmtDateTime(t.lastMessageAt)}</Num>
            {t.messageCount > 1 ? (
              <>
                {' '}· <Num>{t.messageCount}</Num> Messages
              </>
            ) : null}
          </p>

          {t.snippet ? (
            <p className="mt-1 break-words text-[13px] text-neutral-600">{t.snippet.slice(0, 220)}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-start gap-5">
          <div className="text-end">
            <span className="hud-label block text-[11px]">
              {t.lastFromMe ? 'YOU ANSWERED' : 'WAITING'}
            </span>
            <span
              className={`font-cond text-[19px] leading-none ${
                stale ? 'text-sev-warning' : 'text-neutral-900'
              }`}
            >
              <Num>{t.daysWaiting}d</Num>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!t.lastFromMe && !sent ? (
          <Button type="button" size="xs" onClick={() => setReplying((v) => !v)}>
            {replying ? 'CLOSE' : 'REPLY'}
          </Button>
        ) : null}
        {sent ? (
          <span className="font-semi text-[11.5px] uppercase tracking-[0.14em] text-info">
            Sent ✓
          </span>
        ) : null}

        <Attachments kind="thread" id={t.threadId} />

        <a
          href={t.url}
          target="_blank"
          rel="noreferrer"
          className="font-semi text-[11.5px] uppercase tracking-[0.14em] text-info hover:underline"
        >
          Open in Gmail ↗
        </a>

        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const data = new FormData();
              data.set('threadId', t.threadId);
              if (dismissed) data.set('undo', '1');
              const result = await dismissThreadAction(data);
              setError(result.ok ? null : (result.error ?? 'That did not work'));
              if (result.ok) {
                undo.offer();
                router.refresh();
              }
            })
          }
          title={
            dismissed
              ? 'Put it back in “needs a reply”'
              : 'Dealt with elsewhere — stop showing it as waiting'
          }
        >
          {pending ? '…' : dismissed ? 'STILL WAITING' : 'MARK HANDLED'}
        </Button>

        {/*
          The capture path for mail. The thread is already mirrored, so this
          needs nothing from Gmail — it files the conversation as an
          opportunity with its subject, counterpart and link intact, which is
          the step that otherwise never happens.
        */}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={pending || captured}
          onClick={() =>
            startTransition(async () => {
              const data = new FormData();
              data.set('threadId', t.threadId);
              const result = await captureMailAction(data);
              setError(result.ok ? null : (result.error ?? 'That did not work'));
              if (result.ok) {
                setCaptured(true);
                router.refresh();
              }
            })
          }
          title="Put this conversation in the deals inbox to decide on later"
        >
          {captured ? 'IN THE INBOX ✓' : '→ SUGGEST'}
        </Button>

        {/*
          The other thing a conversation turns into. Mail that means work is
          the mail that gets forgotten — read, meant to act on, and gone down
          the inbox by the afternoon. One click makes a task carrying the
          subject, the sender and a link back to the thread.
        */}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={pending || taskId !== null}
          onClick={() =>
            startTransition(async () => {
              const data = new FormData();
              data.set('threadId', t.threadId);
              const result = await taskFromMailAction(data);
              setError(result.ok ? null : (result.error ?? 'That did not work'));
              if (result.ok && result.id) {
                setTaskId(result.id);
                router.refresh();
              }
            })
          }
          title="Make a task out of this conversation"
        >
          {taskId ? 'TASK MADE ✓' : '→ TASK'}
        </Button>

        {/*
          The third thing a conversation turns into. An opportunity is
          something he noticed; a task is something to do; the pipeline is a
          deal that has started, which is what most first mails from a new
          partner actually are.
        */}
        <ToPipeline threadId={t.threadId} />

        {taskId ? (
          <Link
            href={`/tasks?q=${encodeURIComponent(t.subject ?? '')}`}
            className="font-semi text-[11.5px] uppercase tracking-[0.14em] text-info hover:underline"
          >
            Open it ↗
          </Link>
        ) : null}

        {error ? <span className="text-2xs text-destructive">{error}</span> : null}
      </div>

      {replying ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 border border-line p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            data.set('threadId', t.threadId);
            startTransition(async () => {
              const result = await replyAction(data);
              setError(result.ok ? null : (result.error ?? 'Could not send it'));
              if (result.ok) {
                setSent(true);
                setReplying(false);
                router.refresh();
              }
            });
          }}
        >
          <label className="sr-only" htmlFor={`reply-${t.threadId}`}>
            Reply
          </label>
          <Textarea
            id={`reply-${t.threadId}`}
            name="text"
            rows={3}
            required
            placeholder={`Reply to ${t.counterpartName || t.counterpartEmail || 'them'}`}
            className="min-w-0 flex-1"
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'SENDING…' : 'SEND'}
          </Button>
          <span className="pb-1.5 font-semi text-[11.5px] tracking-[0.1em] text-neutral-500">
            Goes out from your address, in this thread
          </span>
        </form>
      ) : null}
    </li>
  );
}
