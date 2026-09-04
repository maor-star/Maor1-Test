import Link from 'next/link';
import type { TaskRow } from '@/lib/tasks/queries';
import { TaskListRow } from '@/components/tasks/list-row';
import { Num } from '@/components/num';

/** Kept in step with the header row: the inline editor spans the whole table. */
const COLUMNS = 10;

/**
 * Spec 6.4 — the list view. Every row carries its actions, and now its whole
 * task: EDIT opens the editor in place rather than sending him to a page and
 * losing the list he was working through.
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
      <div className="hud-card hud-marks p-6 text-center font-semi text-[12px] text-neutral-500">
        No tasks match this filter.
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="hud-card hud-marks overflow-x-auto">
      <table className="cockpit-table">
        <thead>
          <tr>
            <th className="w-[30%]">Task</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Department</th>
            <th>Owner</th>
            <th>Due</th>
            {/* Sorting by newest or oldest is only legible if the date is on
                the row — otherwise the list reorders and says nothing. */}
            <th>Added</th>
            <th>Impact</th>
            <th>Heat</th>
            <th className="text-end">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <TaskListRow
              key={t.id}
              task={t}
              people={people}
              departments={departments}
              now={now}
              columns={COLUMNS}
            />
          ))}
        </tbody>
      </table>
      <div className="border-t border-line px-3 py-2 font-semi text-[11px] tracking-[0.1em] text-neutral-500">
        <Num>{rows.length}</Num> TASKS ·{' '}
        <Link href="/delegations" className="text-info hover:underline">Delegation Tracker</Link>
      </div>
    </div>
  );
}
