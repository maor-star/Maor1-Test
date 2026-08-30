'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { dismissThreadAction } from '@/app/actions/mail';
import { captureMailAction } from '@/app/actions/opportunities';
import { Button } from '@/components/ui/button';
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
  const router = useRouter();

  const dismissed = t.dismissedAt !== null;
  const stale = !t.lastFromMe && t.daysWaiting >= 3;

  return (
    <li className="border-t border-divider px-[18px] py-3">
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
            {t.unread ? <Tag tone="outline">UNREAD</Tag> : null}
            {t.starred ? <Tag tone="outline">STARRED</Tag> : null}
            {dismissed ? <Tag tone="neutral">HANDLED</Tag> : null}
          </div>

          <p className="hud-label mt-1 whitespace-normal text-[9px]">
            {t.counterpartName || t.counterpartEmail || 'UNKNOWN'}
            {t.counterpartName && t.counterpartEmail ? ` · ${t.counterpartEmail}` : ''} ·{' '}
            <Num>{fmtDateTime(t.lastMessageAt)}</Num>
            {t.messageCount > 1 ? (
              <>
                {' '}· <Num>{t.messageCount}</Num> MESSAGES
              </>
            ) : null}
          </p>

          {t.snippet ? (
            <p className="mt-1 break-words text-[13px] text-neutral-600">{t.snippet.slice(0, 220)}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-start gap-5">
          <div className="text-end">
            <span className="hud-label block text-[9px]">
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
        <a
          href={t.url}
          target="_blank"
          rel="noreferrer"
          className="font-semi text-[10px] uppercase tracking-[0.14em] text-accent-700 hover:text-accent"
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
              if (result.ok) router.refresh();
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
          title="File this conversation as an opportunity to come back to"
        >
          {captured ? 'SAVED AS OPPORTUNITY ✓' : '→ OPPORTUNITY'}
        </Button>

        {error ? <span className="text-2xs text-destructive">{error}</span> : null}
      </div>
    </li>
  );
}
