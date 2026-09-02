'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { decideAction, runReviewAction } from '@/app/actions/copilot';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { useUndo } from '@/components/ui/undo-bar';
import { fmtDateTime } from '@/lib/utils';
import type { DecisionRow } from '@/lib/copilot/autopilot';

/**
 * The autopilot's log, and the two buttons that matter on it.
 *
 * Each decision says what it saw, why, and what it would do. At level 1 they
 * wait here for him; approving one carries it out through the same tools the
 * chat uses. A declined decision is kept: the ones he said no to are the ones
 * that teach the next review.
 */
export function DecisionLog({ decisions, canReview }: { decisions: DecisionRow[]; canReview: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  const undo = useUndo();

  const decideOn = (id: string, approve: boolean) => {
    const data = new FormData();
    data.set('id', id);
    data.set('approve', approve ? '1' : '0');
    startTransition(async () => {
      const result = await decideAction(data);
      setMessage(result.ok ? (result.message ?? 'Done') : (result.error ?? 'That did not work'));
      if (result.ok) {
        if (approve) undo.offer();
        router.refresh();
      }
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-[18px] pb-3">
        <Button
          type="button"
          size="sm"
          disabled={pending || !canReview}
          title={canReview ? 'Review the whole company now, under the autopilot agent’s level and dials' : 'Connect a model first'}
          onClick={() =>
            startTransition(async () => {
              const result = await runReviewAction();
              setMessage(result.ok ? (result.message ?? 'Reviewed') : (result.error ?? 'That did not work'));
              router.refresh();
            })
          }
        >
          {pending ? 'REVIEWING THE COMPANY…' : 'RUN THE REVIEW NOW'}
        </Button>
        {message ? <span className="whitespace-pre-wrap font-semi text-[11px] tracking-[0.06em] text-neutral-600">{message}</span> : null}
      </div>

      {decisions.length === 0 ? (
        <p className="border-t border-divider px-[18px] py-4 font-semi text-[12px] text-neutral-500">
          No review yet. Press the button, or switch the autopilot agent on and it runs every morning.
        </p>
      ) : (
        <ul>
          {decisions.map((d) => (
            <li key={d.id} className="border-t border-divider px-[18px] py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone="outline">{d.area.toUpperCase()}</Tag>
                    <StatusTag status={d.status} />
                    <span className="hud-label text-[9px]"><Num>{fmtDateTime(d.createdAt)}</Num></span>
                  </div>
                  <p className="mt-1 font-cond text-[16px] leading-tight text-neutral-900">{d.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-600">{d.reasoning}</p>
                  <p className="hud-label mt-1 whitespace-normal text-[9px]">
                    WOULD {String(d.action.kind ?? 'none').toUpperCase()}
                    {d.action.kind === 'task' && d.action.title ? `: ${String(d.action.title)}` : ''}
                    {d.action.kind === 'stage' ? `: → ${String(d.action.stage ?? '')}` : ''}
                    {d.action.kind === 'agent' ? `: ${String(d.action.agentName ?? '')} ${d.action.enabled ? 'ON' : 'OFF'}` : ''}
                    {d.action.kind === 'slack' ? `: #${String(d.action.channel ?? 'a channel')}` : ''}
                    {d.executedRef ? ` · ${d.executedRef}` : ''}
                  </p>
                  {/* A Slack message is the one thing here the whole company
                      reads, so he sees the words before he approves them. */}
                  {d.action.kind === 'slack' && d.action.text ? (
                    <p className="mt-1 whitespace-pre-wrap border-s-2 border-divider ps-2 text-[13px] leading-relaxed text-neutral-800">
                      {String(d.action.text)}
                    </p>
                  ) : null}
                </div>
                {d.status === 'proposed' ? (
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" size="xs" disabled={pending} onClick={() => decideOn(d.id, true)}>
                      {d.action.kind === 'slack' ? 'POST IT' : 'DO IT'}
                    </Button>
                    <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => decideOn(d.id, false)}>
                      NO
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusTag({ status }: { status: string }) {
  const tone = status === 'executed' || status === 'approved' ? 'ok' : status === 'declined' ? 'neutral' : status === 'noted' ? 'outline' : 'warning';
  const label = status === 'proposed' ? 'WAITING FOR YOU' : status.toUpperCase();
  return <Tag tone={tone}>{label}</Tag>;
}
