import { addDays, eachDayOfInterval, endOfMonth, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import type { TaskRow } from '@/lib/tasks/queries';
import { Num } from '@/components/num';
import { PriorityBadge, TaskTitleLink } from '@/components/task-bits';
import { cn } from '@/lib/utils';

/** Hebrew week starts on Sunday. */
const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

/** Spec 6.1.1 — the calendar view over due dates. */
export function TaskCalendarView({ rows, today }: { rows: TaskRow[]; today: string }) {
  const anchor = new Date(`${today}T00:00:00Z`);
  const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn: 0 });
  const gridEnd = addDays(startOfWeek(endOfMonth(anchor), { weekStartsOn: 0 }), 6);
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const byDay = new Map<string, TaskRow[]>();
  for (const row of rows) {
    if (!row.dueDate) continue;
    const bucket = byDay.get(row.dueDate);
    if (bucket) bucket.push(row);
    else byDay.set(row.dueDate, [row]);
  }

  const undated = rows.filter((r) => !r.dueDate);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-7 border-b bg-muted/50">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1 text-center text-2xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd');
            const items = byDay.get(key) ?? [];
            const isToday = key === today;
            return (
              <div
                key={key}
                className={cn(
                  'min-h-24 border-b border-s p-1',
                  !isSameMonth(day, anchor) && 'bg-muted/30',
                  isToday && 'ring-1 ring-inset ring-ring',
                )}
              >
                <Num
                  className={cn(
                    'text-2xs',
                    isToday ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {format(day, 'd')}
                </Num>
                <ul className="mt-1 space-y-0.5">
                  {items.slice(0, 3).map((t) => (
                    <li key={t.id} className="truncate text-2xs">
                      <TaskTitleLink id={t.id} title={t.title} />
                    </li>
                  ))}
                  {items.length > 3 ? (
                    <li className="text-2xs text-muted-foreground">
                      +<Num>{items.length - 3}</Num>
                    </li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {undated.length > 0 ? (
        <div className="rounded-lg border p-2">
          <h2 className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            ללא תאריך יעד (<Num>{undated.length}</Num>)
          </h2>
          <ul className="space-y-1">
            {undated.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-xs">
                <PriorityBadge priority={t.priority} />
                <TaskTitleLink id={t.id} title={t.title} clickupUrl={t.clickupUrl} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
