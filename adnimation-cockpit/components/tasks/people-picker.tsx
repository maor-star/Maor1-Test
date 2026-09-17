'use client';

import { useState } from 'react';

/**
 * Who is on a task — pick as many as it takes.
 *
 * The order is the point. Alphabetical is the order nobody wants: four or five
 * names carry almost every hand-over on this board, so sorting by name puts
 * the person he needs eighth and somebody he has never given anything to
 * first. The list arrives already ranked by how often he has CHOSEN each
 * person — every task he put them on plus every hand-over he sent them (see
 * lib/tasks/people-order.ts) — and this draws it in that order.
 *
 * The first name ticked is the LEAD — the one the row sorts under and the one
 * the heat score reads — so the position is shown on the chip rather than left
 * to be inferred from a rule nobody was told.
 *
 * It posts one `assignees` value per person, always, including an empty one
 * when nobody is picked: an absent field means "leave them alone" to the
 * action, so taking the last person off has to arrive as an empty list rather
 * than as nothing at all.
 */
export function PeoplePicker({
  people,
  value,
  onChange,
  label = 'On this task',
  /** How many to show before "more"; the rest are one click away. */
  visible = 6,
}: {
  people: { id: string; label: string; picks?: number; onTasks?: number }[];
  value: string[];
  onChange: (next: string[]) => void;
  label?: string;
  visible?: number;
}) {
  const [showAll, setShowAll] = useState(false);

  // Anyone already picked is always drawn, however far down the list they sit
  // — a name hidden behind "more" while it is ticked reads as not ticked.
  const shown = showAll
    ? people
    : people.filter((p, i) => i < visible || value.includes(p.id));
  const hidden = people.length - shown.length;

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <fieldset className="space-y-1">
      <legend className="hud-label text-[10.5px]">
        {label}
        {value.length > 1 ? ` · ${value.length} people, first is lead` : ''}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((p) => {
          const at = value.indexOf(p.id);
          const on = at !== -1;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(p.id)}
              /* Why this name is where it is, and what they are carrying now
                 — the sort key and the workload are different facts, so the
                 hover says both rather than implying one from the other. */
              title={[
                p.label,
                p.picks ? `picked ${p.picks} times` : null,
                p.onTasks ? `on ${p.onTasks} open ${p.onTasks === 1 ? 'task' : 'tasks'} now` : null,
              ]
                .filter(Boolean)
                .join(' — ')}
              className={`rounded-full border px-2.5 py-1 text-[12px] ${
                on
                  ? 'border-accent bg-accent/10 font-semibold text-accent'
                  : 'border-line text-muted hover:bg-neutral-100'
              }`}
            >
              {on && value.length > 1 ? `${at + 1}. ` : ''}
              {p.label}
            </button>
          );
        })}
        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="rounded-full border border-dashed border-line px-2.5 py-1 text-[12px] text-muted hover:bg-neutral-100"
          >
            +{hidden} more
          </button>
        ) : null}
      </div>

      {/*
        The form's copy of the answer. Rendered rather than assembled at submit
        time so a plain `action={…}` form carries it without any JavaScript of
        its own, and the empty entry is what tells the server "nobody" rather
        than "unchanged".
      */}
      {value.length === 0 ? (
        <input type="hidden" name="assignees" value="" />
      ) : (
        value.map((id) => <input key={id} type="hidden" name="assignees" value={id} />)
      )}
    </fieldset>
  );
}
