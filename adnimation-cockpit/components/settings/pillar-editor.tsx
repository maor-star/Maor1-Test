'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addPillarAction, movePillarAction, renamePillarAction, togglePillarAction,
} from '@/app/actions/pillars';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Num } from '@/components/num';

export interface EditablePillar {
  line: string;
  label: string;
  active: boolean;
  hasRevenue: boolean;
  /** How many tasks, deals and contracts carry it. */
  tagged: number;
}

/**
 * The pillar list, one row per pillar.
 *
 * A name he can type over, an arrow each way, and a switch. No delete: the
 * work already tagged with a pillar keeps its tag when the pillar is hidden,
 * and that is the whole difference between hiding one and losing forty
 * contracts' worth of filing.
 *
 * The count on each row is what is riding on it, so hiding one is a decision
 * taken in front of the number rather than behind it.
 */
export function PillarEditor({ pillars }: { pillars: EditablePillar[] }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const run = (action: (fd: FormData) => Promise<{ ok: boolean; error?: string; notice?: string }>, fd: FormData) =>
    startTransition(async () => {
      const result = await action(fd);
      setError(result.ok ? null : (result.error ?? 'That did not save'));
      setMessage(result.ok ? (result.notice ?? 'Saved') : null);
      if (result.ok) router.refresh();
    });

  const field = (name: string, value: string) => {
    const fd = new FormData();
    fd.set(name, value);
    return fd;
  };

  return (
    <div>
      <ul className="border-t border-line">
        {pillars.map((p, i) => (
          <li
            key={p.line}
            className={`flex flex-wrap items-center gap-2 border-b border-line px-[18px] py-2.5 ${
              p.active ? '' : 'bg-neutral-50'
            }`}
          >
            <div className="flex shrink-0 flex-col">
              <button
                type="button"
                aria-label={`Move ${p.label} up`}
                disabled={i === 0 || pending}
                onClick={() => {
                  const fd = field('line', p.line);
                  fd.set('direction', 'up');
                  run(movePillarAction, fd);
                }}
                className="px-1 text-[11px] leading-none text-muted hover:text-ink disabled:opacity-25"
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`Move ${p.label} down`}
                disabled={i === pillars.length - 1 || pending}
                onClick={() => {
                  const fd = field('line', p.line);
                  fd.set('direction', 'down');
                  run(movePillarAction, fd);
                }}
                className="px-1 text-[11px] leading-none text-muted hover:text-ink disabled:opacity-25"
              >
                ▼
              </button>
            </div>

            {/* Typed over in place and saved on blur — a row of seven names is
                not a form worth a Save button each. */}
            <Input
              defaultValue={p.label}
              aria-label={`Name of ${p.label}`}
              className="min-w-48 flex-1"
              onBlur={(e) => {
                const next = e.currentTarget.value.trim();
                if (next === p.label || next === '') return;
                const fd = field('line', p.line);
                fd.set('label', next);
                run(renamePillarAction, fd);
              }}
            />

            <span className="hud-label shrink-0 text-[10.5px] text-muted" title="The key stored on every tag and target">
              {p.line}
            </span>

            <span className="shrink-0 text-[12px] text-muted">
              <Num>{p.tagged}</Num> tagged
            </span>

            {p.hasRevenue ? (
              <span
                className="hud-label shrink-0 rounded-full border border-line px-2 py-[3px] text-[10.5px] text-muted"
                title="The revenue sync reports figures for this one, so it has a tile on the overview"
              >
                HAS REVENUE
              </span>
            ) : (
              <span
                className="hud-label shrink-0 rounded-full border border-dashed border-line px-2 py-[3px] text-[10.5px] text-muted"
                title="Tag it and filter by it anywhere; no source reports figures for it, so it has no tile on the overview"
              >
                TAG ONLY
              </span>
            )}

            <Button
              type="button"
              size="xs"
              variant={p.active ? 'ghost' : 'default'}
              disabled={pending}
              onClick={() => {
                const fd = field('line', p.line);
                fd.set('active', p.active ? 'false' : 'true');
                run(togglePillarAction, fd);
              }}
              title={
                p.active
                  ? 'Take it off the boards. Everything tagged with it keeps the tag.'
                  : 'Put it back on the boards.'
              }
            >
              {p.active ? 'HIDE' : 'SHOW'}
            </Button>
          </li>
        ))}
      </ul>

      <form
        className="flex flex-wrap items-center gap-2 px-[18px] py-3"
        action={(fd) => run(addPillarAction, fd)}
      >
        <Input
          name="label"
          required
          placeholder="Add a pillar — what do you call it?"
          className="min-w-56 flex-1"
          aria-label="New pillar name"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'SAVING…' : 'ADD'}
        </Button>
      </form>

      {error ? <p className="px-[18px] pb-3 text-[12px] text-neg">{error}</p> : null}
      {message && !error ? <p className="px-[18px] pb-3 text-[12px] text-pos">{message}</p> : null}
    </div>
  );
}
