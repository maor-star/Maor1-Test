import Link from 'next/link';
import { listDepartments, listPeople, listTasks, type TaskRow } from '@/lib/tasks/queries';
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from '@/lib/tasks/types';
import { todayInTz } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { TaskListView } from '@/components/tasks/list-view';
import { TaskBoardView } from '@/components/tasks/board-view';
import { TaskCalendarView } from '@/components/tasks/calendar-view';
import { TaskFilters } from '@/components/tasks/filters';
import { NewTaskForm } from '@/components/tasks/new-task-form';

export const dynamic = 'force-dynamic';

const VIEWS = ['list', 'board', 'calendar'] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABEL: Record<View, string> = {
  list: 'LIST',
  board: 'BOARD',
  calendar: 'CALENDAR',
};

interface SearchParams {
  view?: string;
  layer?: string;
  q?: string;
  priority?: string;
  status?: string;
  dept?: string;
}

/** Spec 6.1.1 / 6.4 — my tasks and the ClickUp mirror, in three views. */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const view: View = VIEWS.includes(sp.view as View) ? (sp.view as View) : 'list';
  // Default to every layer. Every real task now arrives through the ClickUp
  // mirror as `company`, so defaulting to `mine` opened the page on an empty
  // list while 200+ live tasks sat one click away.
  const layer =
    sp.layer === 'company' ? 'company' : sp.layer === 'mine' ? 'mine' : undefined;

  const priority = sp.priority && TASK_PRIORITIES.includes(sp.priority as TaskPriority)
    ? [sp.priority as TaskPriority]
    : undefined;
  const status = sp.status && TASK_STATUSES.includes(sp.status as TaskStatus)
    ? [sp.status as TaskStatus]
    : undefined;

  const [rows, departments, people] = await Promise.all([
    listTasks({
      layer,
      search: sp.q,
      priority,
      status,
      deptId: sp.dept || undefined,
      includeDone: status?.includes('done') ?? false,
    }),
    listDepartments(),
    listPeople(),
  ]);

  const query = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/tasks?${qs}` : '/tasks';
  };

  return (
    <div className="space-y-3">
      <PageHeader
        kicker="TASKS / 03"
        title="Tasks"
        action={
          <nav className="flex border border-divider">
            {VIEWS.map((v) => (
              <Link
                key={v}
                href={query({ view: v })}
                className={`px-3 py-1 font-semi text-[11px] tracking-[0.16em] ${
                  v === view ? 'bg-accent text-ground' : 'text-neutral-500 hover:text-accent'
                }`}
              >
                {VIEW_LABEL[v]}
              </Link>
            ))}
          </nav>
        }
      />

      <TaskFilters
        departments={departments.map((d) => ({ id: d.id, label: d.nameHe }))}
        current={{
          layer: sp.layer ?? 'all',
          q: sp.q ?? '',
          priority: sp.priority ?? '',
          status: sp.status ?? '',
          dept: sp.dept ?? '',
          view,
        }}
      />

      <HudCard>
        <HudCardHeader title="New task" index="T02" />
        <NewTaskForm
          departments={departments.map((d) => ({ id: d.id, label: d.nameHe }))}
          people={people.map((p) => ({ id: p.id, label: p.name }))}
        />
      </HudCard>

      <TaskViewSwitch view={view} rows={rows} people={people.map((p) => ({ id: p.id, label: p.name }))} />
    </div>
  );
}

function TaskViewSwitch({
  view,
  rows,
  people,
}: {
  view: View;
  rows: TaskRow[];
  people: { id: string; label: string }[];
}) {
  if (view === 'board') return <TaskBoardView rows={rows} />;
  if (view === 'calendar') return <TaskCalendarView rows={rows} today={todayInTz()} />;
  return <TaskListView rows={rows} people={people} />;
}
