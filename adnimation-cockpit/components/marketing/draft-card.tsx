'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { declineDraftAction, editDraftAction, publishDraftAction } from '@/app/actions/marketing';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { fmtDateTime } from '@/lib/utils';
import { MAX_POST_CHARS, type Draft } from '@/lib/marketing/types';

const SOURCE_LABEL: Record<string, string> = {
  contracts: 'FROM A SIGNED CONTRACT',
  deals: 'FROM A DEAL',
  mail: 'FROM YOUR MAIL',
  manual: 'WRITTEN BY HAND',
};

/**
 * One post, as he reads it before the world does.
 *
 * The text is editable in place, because the last edit before publishing is
 * always his and making him copy it somewhere else to make it would mean the
 * published version is not the one the cockpit knows about. Publishing is
 * behind a second click for the obvious reason: there is no unpublish.
 */
export function DraftCard({ draft, canPublish, missing }: { draft: Draft; canPublish: boolean; missing: string[] }) {
  const [body, setBody] = useState(draft.body);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const dirty = body.trim() !== draft.body.trim();
  const open = draft.status === 'draft';

  const run = (action: (data: FormData) => Promise<{ ok: boolean; error?: string; message?: string }>, extra?: Record<string, string>) => {
    const data = new FormData();
    data.set('id', draft.id);
    for (const [k, v] of Object.entries(extra ?? {})) data.set(k, v);
    startTransition(async () => {
      const result = await action(data);
      setMessage(result.ok ? (result.message ?? 'Done') : (result.error ?? 'That did not work'));
      if (result.ok) router.refresh();
    });
  };

  return (
    <li className="border-t border-divider px-[18px] py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={open ? 'warning' : draft.status === 'posted' ? 'ok' : 'neutral'}>
          {open ? 'WAITING FOR YOU' : draft.status.toUpperCase()}
        </Tag>
        <Tag tone="outline">{SOURCE_LABEL[draft.sourceKind] ?? draft.sourceKind.toUpperCase()}</Tag>
        <span className="hud-label text-[9px]">
          <Num>{fmtDateTime(draft.createdAt)}</Num>
        </span>
        {draft.postedUrl ? (
          <a href={draft.postedUrl} target="_blank" rel="noreferrer" className="hud-label text-[9px] text-accent-700 hover:text-accent">
            OPEN ON LINKEDIN
          </a>
        ) : null}
      </div>

      <p className="mt-1 font-cond text-[16px] leading-tight text-neutral-900">{draft.occasion}</p>

      {open ? (
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={Math.min(18, Math.max(6, body.split('\n').length + 2))}
          className="mt-2 w-full"
          maxLength={MAX_POST_CHARS}
        />
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-800">{body}</p>
      )}

      {draft.flags.length > 0 && open ? (
        <ul className="mt-2 space-y-0.5">
          {draft.flags.map((f) => (
            <li key={f} className="text-2xs text-sev-warning">
              ⚠ {f}
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" size="xs" variant="ghost" disabled={pending || !dirty} onClick={() => run(editDraftAction, { body })}>
            {dirty ? 'SAVE THE EDIT' : 'SAVED'}
          </Button>

          {confirming ? (
            <>
              <Button
                type="button"
                size="xs"
                disabled={pending}
                onClick={() => {
                  // The text on the screen goes with the publish, so an edit he
                  // has not saved is still what goes out.
                  run(publishDraftAction, { body });
                  setConfirming(false);
                }}
              >
                YES — PUBLISH IT
              </Button>
              <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
                NOT YET
              </Button>
              <span className="text-2xs text-neutral-600">This goes out on LinkedIn now and cannot be taken back.</span>
            </>
          ) : (
            <Button
              type="button"
              size="xs"
              disabled={pending || !canPublish}
              title={canPublish ? 'Publish this on LinkedIn' : `Not connected — set ${missing.join(' and ')} on the Keys screen`}
              onClick={() => setConfirming(true)}
            >
              PUBLISH ON LINKEDIN
            </Button>
          )}

          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => navigator.clipboard?.writeText(body).then(() => setMessage('Copied.'), () => setMessage('Could not copy.'))}
          >
            COPY
          </Button>
          <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => run(declineDraftAction)}>
            NOT THIS ONE
          </Button>
          <span className="hud-label text-[9px]">
            <Num>{body.length}</Num>/<Num>{MAX_POST_CHARS}</Num>
          </span>
          {message ? <span className="text-2xs text-neutral-600">{message}</span> : null}
        </div>
      ) : null}
    </li>
  );
}
