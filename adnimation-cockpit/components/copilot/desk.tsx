'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Num } from '@/components/num';
import { DeskCard } from '@/components/copilot/desk-card';
import { draftAllAction } from '@/app/actions/desk';
import { CHANNEL_LABEL, DESK_CHANNELS, type DeskChannel, type DeskItem } from '@/lib/copilot/desk-rules';
import type { DeskDraft } from '@/lib/copilot/desk-draft';

/**
 * The desk: everything owed, loudest first, each with its answer ready.
 *
 * The channel filter is a filter, not a set of tabs — he works down one list,
 * and the day he wants only the contracts he says so. What he never wants is
 * to find out there were four unanswered mails on a tab he did not open.
 */
export function CopilotDesk({
  items,
  drafts,
  team,
}: {
  items: DeskItem[];
  /** Item id → what is prepared for it and whether it still fits. */
  drafts: Record<string, { draft: DeskDraft; stale: boolean }>;
  team: { id: string; label: string }[];
}) {
  const [only, setOnly] = useState<DeskChannel | 'all'>('all');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const shown = only === 'all' ? items : items.filter((i) => i.channel === only);
  const undrafted = items.filter((i) => !drafts[i.id] || drafts[i.id]!.stale).length;

  const counts = new Map<DeskChannel, number>();
  for (const i of items) counts.set(i.channel, (counts.get(i.channel) ?? 0) + 1);

  const prepare = () =>
    startTransition(async () => {
      const result = await draftAllAction();
      setMessage(
        result.needsKey
          ? 'No model is connected — paste an Anthropic key on the keys screen and it will write these.'
          : result.drafted > 0
            ? `Prepared ${result.drafted}${result.failed > 0 ? `, ${result.failed} it could not` : ''}.`
            : (result.error ?? 'Everything already has an answer.'),
      );
      router.refresh();
    });

  return (
    <div className="hud-card">
      <div className="flex flex-wrap items-center justify-between gap-3 p-[18px] pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip label="Everything" count={items.length} on={only === 'all'} onClick={() => setOnly('all')} />
          {DESK_CHANNELS.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => (
            <Chip
              key={c}
              label={CHANNEL_LABEL[c]}
              count={counts.get(c) ?? 0}
              on={only === c}
              onClick={() => setOnly(c)}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {message ? <span className="text-[12px] text-muted">{message}</span> : null}
          <Button
            type="button"
            size="xs"
            variant={undrafted > 0 ? 'default' : 'outline'}
            disabled={pending || undrafted === 0}
            onClick={prepare}
            title="Write an answer for everything that has not got one"
          >
            {pending
              ? 'THINKING…'
              : undrafted === 0
                ? 'EVERYTHING HAS AN ANSWER'
                : `PREPARE ${Math.min(undrafted, 10)} ANSWERS`}
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="border-t border-line px-[18px] py-6 text-center text-[13.5px] text-muted">
          Nothing is waiting on you here.
        </p>
      ) : (
        <ul>
          {shown.map((i) => (
            <DeskCard
              key={i.id}
              item={i}
              draft={drafts[i.id]?.draft ?? null}
              stale={drafts[i.id]?.stale ?? false}
              team={team}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`hud-label rounded-full border px-3 py-[7px] text-[11.5px] ${
        on ? 'border-ink bg-ink text-white' : 'border-line bg-card hover:border-neutral-300'
      }`}
    >
      {label} <Num>{count}</Num>
    </button>
  );
}
