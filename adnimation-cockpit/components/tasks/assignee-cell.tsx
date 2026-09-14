'use client';

import type { AssigneeChip } from '@/lib/tasks/assignee-chip';

/**
 * Everyone on a task, on the row.
 *
 * It was a single-select of one owner, which was the mirror's limitation
 * showing through rather than a decision: ClickUp's first assignee was all it
 * kept, so a task two people run showed one name and lost the other, and the
 * board answered "who is carrying this" wrongly every time.
 *
 * Picking the people is in the quick-edit panel rather than here, and on
 * purpose. Several names need a list of tick-boxes, a list needs somewhere to
 * open, and the group is a card with its corners clipped — a panel opening
 * over the rows would be cut off at the card's edge. So the cell shows who is
 * on it and opens the panel that can change it, which is one trip either way.
 */
export function AssigneeCell({
  people,
  onEdit,
}: {
  people: AssigneeChip[];
  onEdit: () => void;
}) {
  const label =
    people.length === 0
      ? 'UNASSIGNED'
      : people.length === 1
        ? people[0]!.name
        : `${people[0]!.name} +${people.length - 1}`;

  return (
    <button
      type="button"
      onClick={onEdit}
      title={people.length > 0 ? people.map((p) => p.name).join(', ') : 'Nobody is on this yet'}
      className={`w-full truncate rounded-[5px] px-2 py-1.5 text-center text-[11.5px] hover:bg-neutral-100 ${
        people.length === 0 ? 'text-muted' : 'text-ink'
      }`}
    >
      {label}
    </button>
  );
}
