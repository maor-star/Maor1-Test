'use client';

import { useState } from 'react';
import { PILLAR_OPTIONS } from '@/lib/control/pillars';

/**
 * Which pillars a thing belongs to — ticked, not chosen from a list.
 *
 * A `<select multiple>` is the control nobody knows how to use: it needs a
 * held key to pick a second option and it shows three of seven rows. These are
 * seven chips he taps, and the ones that are on look on.
 *
 * The values ride in hidden inputs named `lines`, so the form posts them like
 * any other field and the editors need no special handling.
 */
export function PillarPicker({
  name = 'lines',
  selected,
  id,
}: {
  name?: string;
  selected: readonly string[];
  /** Unique per form — two editors can be open on one screen. */
  id: string;
}) {
  const [on, setOn] = useState<string[]>([...selected]);

  const toggle = (line: string) =>
    setOn((held) => (held.includes(line) ? held.filter((l) => l !== line) : [...held, line]));

  return (
    <>
      {on.map((line) => (
        <input key={line} type="hidden" name={name} value={line} />
      ))}
      <div className="flex flex-wrap gap-1">
        {PILLAR_OPTIONS.map((p) => {
          const picked = on.includes(p.line);
          return (
            <button
              key={p.line}
              type="button"
              aria-pressed={picked}
              onClick={() => toggle(p.line)}
              id={`${id}-${p.line}`}
              className={`hud-label rounded-full border px-2.5 py-[6px] text-[11px] ${
                picked
                  ? 'border-ink bg-ink text-white'
                  : 'border-line bg-card text-muted hover:border-neutral-300 hover:text-ink'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** The pillars on a card, read-only. */
export function PillarTags({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  const labels = PILLAR_OPTIONS.filter((p) => lines.includes(p.line));
  return (
    <>
      {labels.map((p) => (
        <span
          key={p.line}
          className="hud-label rounded-full border border-line px-2 py-[3px] text-[10.5px] text-muted"
        >
          {p.label}
        </span>
      ))}
    </>
  );
}
