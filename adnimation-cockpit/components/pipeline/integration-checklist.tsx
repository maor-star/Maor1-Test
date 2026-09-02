'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setIntegrationStepAction } from '@/app/actions/pipeline';
import { Input } from '@/components/ui/input';
import { Num } from '@/components/num';
import { useUndo } from '@/components/ui/undo-bar';
import type { IntegrationProgress } from '@/lib/pipeline/integration';
import { fmtDate } from '@/lib/utils';

/**
 * The steps between "they signed" and "money is arriving".
 *
 * Integration as a single stage is the stage deals die in: it can hold a deal
 * for two months and the board reads the same on day one and day sixty. The
 * answer to "why is this not live" is always one specific missing step, and
 * nearly always someone who does not know it is waiting on them — so every
 * step carries a line for who that is.
 *
 * Each tick is one server call and is undoable, because the whole map is
 * written and put back together.
 */
export function IntegrationChecklist({
  clientId,
  progress,
}: {
  clientId: string;
  progress: IntegrationProgress;
}) {
  const [pending, startTransition] = useTransition();
  const [blocking, setBlocking] = useState<string | null>(null);
  const router = useRouter();
  const undo = useUndo();

  const send = (key: string, patch: Record<string, string>) => {
    const data = new FormData();
    data.set('clientId', clientId);
    data.set('key', key);
    for (const [k, v] of Object.entries(patch)) data.set(k, v);
    startTransition(async () => {
      const result = await setIntegrationStepAction(data);
      if (result.ok) {
        undo.offer();
        router.refresh();
      }
    });
  };

  return (
    <div className="mt-2 border border-divider p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="hud-label text-[9px]">
          GOING LIVE · <Num>{progress.done}</Num>/<Num>{progress.total}</Num>
        </span>
        <span className="font-semi text-[10px] tracking-[0.1em] text-neutral-500">
          {progress.complete ? (
            'EVERY STEP DONE'
          ) : progress.waitingOn ? (
            <>
              WAITING ON: {progress.waitingOn.label.toUpperCase()}
              {progress.waitingOn.blockedOn ? ` — ${progress.waitingOn.blockedOn}` : ''}
            </>
          ) : null}
        </span>
      </div>

      {/* The bar is the one thing readable from across the room. */}
      <div className="mt-1.5 h-1 w-full bg-neutral-200">
        <div
          className={`h-1 ${progress.complete ? 'bg-sev-ok' : 'bg-accent'}`}
          style={{ width: `${Math.round(progress.ratio * 100)}%` }}
        />
      </div>

      <ul className="mt-2 space-y-1.5">
        {progress.steps.map((s) => (
          <li key={s.key} className="min-w-0">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={s.done}
                disabled={pending}
                onChange={(e) => send(s.key, { done: e.target.checked ? '1' : '0' })}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span className="min-w-0">
                <span className={`text-[13px] ${s.done ? 'text-neutral-500 line-through' : 'text-neutral-800'}`}>
                  {s.label}
                </span>
                <span className="hud-label ms-2 whitespace-normal text-[9px]">
                  {s.done && s.at ? <Num>{fmtDate(new Date(s.at))}</Num> : s.meaning}
                </span>
              </span>
            </label>

            {!s.done ? (
              <div className="ms-6 mt-0.5">
                {blocking === s.key ? (
                  <Input
                    autoFocus
                    defaultValue={s.blockedOn ?? ''}
                    placeholder="Who is this waiting on?"
                    className="h-7 max-w-xs text-[12px]"
                    onBlur={(e) => {
                      setBlocking(null);
                      if (e.target.value !== (s.blockedOn ?? '')) send(s.key, { blockedOn: e.target.value });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setBlocking(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setBlocking(s.key)}
                    className="font-semi text-[10px] uppercase tracking-[0.12em] text-neutral-500 hover:text-accent"
                  >
                    {s.blockedOn ? `WAITING ON ${s.blockedOn}` : '+ WHO IS IT WAITING ON'}
                  </button>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
