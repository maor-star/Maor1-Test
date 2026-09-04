'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { closeDealAction } from '@/app/actions/pipeline';
import { Button } from '@/components/ui/button';
import { Label, Select, Textarea } from '@/components/ui/input';
import { Tag } from '@/components/hud/tag';
import { useUndo } from '@/components/ui/undo-bar';
import { CLOSE_LABEL, CLOSE_OUTCOMES, type CloseOutcome } from '@/lib/pipeline/integration';

/**
 * Finishing a deal, and putting one back.
 *
 * Closing is always his call — the board only ever says a deal *looks*
 * finished and offers the button. A closed deal leaves the board and keeps
 * every word of itself, because a list that is mostly finished work stops
 * being read, and deleting the finished work is how the win rate becomes
 * unknowable.
 */
export function CloseDeal({
  clientId,
  closed,
  outcome,
  note,
  suggestion,
}: {
  clientId: string;
  closed: boolean;
  outcome: CloseOutcome | null;
  note: string | null;
  /** Why the board thinks it is finished, when it does. */
  suggestion: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const undo = useUndo();

  const send = (data: FormData) => {
    data.set('clientId', clientId);
    startTransition(async () => {
      const result = await closeDealAction(data);
      setError(result.ok ? null : (result.error ?? 'That did not work'));
      if (result.ok) {
        undo.offer();
        setOpen(false);
        router.refresh();
      }
    });
  };

  if (closed) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Tag tone={outcome === 'won' ? 'ok' : 'neutral'}>
          {outcome ? CLOSE_LABEL[outcome] : 'CLOSED'}
        </Tag>
        {note ? <span className="text-[12px] text-neutral-500">{note}</span> : null}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            const data = new FormData();
            data.set('reopen', '1');
            data.set('outcome', outcome ?? 'won');
            send(data);
          }}
        >
          PUT IT BACK
        </Button>
      </span>
    );
  }

  return (
    <>
      <Button
        type="button"
        size="xs"
        variant={suggestion ? 'default' : 'ghost'}
        onClick={() => setOpen((v) => !v)}
        title={suggestion || 'Close this deal — won or lost'}
      >
        {open ? 'CLOSE' : 'FINISH IT'}
      </Button>

      {open ? (
        <form
          className="mt-2 w-full border border-line p-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(new FormData(e.currentTarget));
          }}
        >
          {suggestion ? (
            <p className="mb-2 font-semi text-[11px] tracking-[0.06em] text-info">{suggestion}</p>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor={`out-${clientId}`}>How did it end</Label>
              <Select id={`out-${clientId}`} name="outcome" defaultValue="won" className="h-8 text-[12px]">
                {CLOSE_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {CLOSE_LABEL[o]}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'CLOSING…' : 'CLOSE IT'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <div className="mt-2">
            <Label htmlFor={`note-${clientId}`}>Why, in a line — this is what the win/loss review reads</Label>
            <Textarea id={`note-${clientId}`} name="note" rows={2} className="w-full" />
          </div>
          {error ? <p className="mt-1 text-[12px] text-sev-warning">{error}</p> : null}
        </form>
      ) : null}
    </>
  );
}
