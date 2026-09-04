import type { TaskRow } from '@/lib/tasks/queries';
import { STATUS_LABEL, TASK_STATUSES, type TaskStatus } from '@/lib/tasks/types';
import { Num } from '@/components/num';
import { HeatBar, PriorityBadge, TaskTitleLink } from '@/components/task-bits';
import { InlineTaskEditor } from '@/components/tasks/inline-task-editor';

/**
 * Spec 6.4 — board by status. Columns are the fixed status set, not free-form.
 *
 * Every card opens its whole task in place, the same as a row in the list: the
 * board is where he moves work along, and moving it along meant leaving the
 * board.
 */
export function TaskBoardView({
  rows,
  people,
  departments,
}: {
  rows: TaskRow[];
  people: { id: string; label: string }[];
  departments: { id: string; label: string }[];
}) {
  const byStatus = new Map<string, TaskRow[]>();
  for (const status of TASK_STATUSES) byStatus.set(status, []);
  for (const row of rows) {
    const bucket = byStatus.get(row.status);
    if (bucket) bucket.push(row);
    else byStatus.set(row.status, [row]);
  }

  return (
    <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
      {[...byStatus.entries()].map(([status, items]) => (
        <section key={status} className="hud-card hud-marks">
          <header className="flex items-center justify-between border-b px-2 py-1.5">
            <h2 className="text-2xs font-medium uppercase tracking-wide text-neutral-500">
              {STATUS_LABEL[status as TaskStatus] ?? status}
            </h2>
            <Num className="text-2xs text-neutral-500">{items.length}</Num>
          </header>
          <ul className="space-y-1 p-1.5">
            {items.length === 0 ? (
              <li className="px-1 py-2 text-2xs text-neutral-500">ריק</li>
            ) : (
              items.map((t) => (
                <li key={t.id} className="border border-line bg-card p-1.5">
                  <TaskTitleLink id={t.id} title={t.title} clickupUrl={t.clickupUrl} />
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <PriorityBadge priority={t.priority} />
                    <HeatBar score={t.heatScore} />
                  </div>
                  {t.dueDate ? (
                    <Num className="mt-1 block text-2xs text-neutral-500">{t.dueDate}</Num>
                  ) : null}
                  <div className="mt-1">
                    <InlineTaskEditor
                      taskId={t.id}
                      departments={departments}
                      people={people}
                    />
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
