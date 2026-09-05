import Link from 'next/link';
import type { TaskRow } from '@/lib/tasks/queries';
import { TaskListRow } from '@/components/tasks/list-row';
import { InstantFilter } from '@/components/hud/instant-filter';
import { Num } from '@/components/num';
import { foldForSearch } from '@/lib/search';

/**
 * Spec 6.4 — the list view, in the shape the contracts screen uses.
 *
 * It was a ten-column table, and the last two columns were off the right of
 * the screen: he could not see the actions on his own tasks. A task is a card
 * now — the thing and its state, the facts about it, what happens next, and
 * the actions — which fits the width, and gives the editor somewhere to open
 * without spanning a row of columns that no longer exist.
 */
export function TaskListView({
  rows,
  people,
  departments,
}: {
  rows: TaskRow[];
  people: { id: string; label: string }[];
  departments: { id: string; label: string }[];
}) {
  if (rows.length === 0) {
    return (
      <div className="hud-card p-6 text-center text-[14.5px] text-muted">
        No tasks match this filter.
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="hud-card p-0">
      <ul id="task-list">
        {/* The list narrows as he types, before the URL has caught up. */}
        <InstantFilter scope="task-list" />
        {rows.map((t) => (
          <TaskListRow
            key={t.id}
            task={t}
            people={people}
            departments={departments}
            now={now}
            search={foldForSearch(
              t.title,
              t.description,
              t.nextStep,
              t.ownerName,
              t.deptNameHe,
              t.status,
              t.priority,
              t.dueDate,
              t.nextStepDate,
              ...t.tags,
            )}
          />
        ))}
      </ul>
      <div className="border-t border-line px-[18px] py-2 text-[12.5px] text-muted">
        <Num>{rows.length}</Num> tasks ·{' '}
        <Link href="/delegations" className="font-semibold text-info hover:underline">
          Delegation tracker
        </Link>
      </div>
    </div>
  );
}
