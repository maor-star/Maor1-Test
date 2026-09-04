import Link from 'next/link';
import { listDepartments, listPeople, listTasks, type TaskRow } from '@/lib/tasks/queries';
import {
  TASK_PRIORITIES, TASK_SORTS, TASK_STATUSES, type TaskPriority, type TaskSort, type TaskStatus,
} from '@/lib/tasks/types';
import { todayInTz } from '@/lib/utils';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { SearchBox } from '@/components/hud/search-box';
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
  sort?: string;
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

  /*
   * Newest first, by default.
   *
   * Heat answers "what should I do next", which is the right question for a
   * list he works through — but he opens this screen after something has
   * happened, and what he is looking for is almost always what just arrived.
   * The heat order is one click away and the score is still on every row.
   */
  const sort: TaskSort = TASK_SORTS.includes(sp.sort as TaskSort)
    ? (sp.sort as TaskSort)
    : 'newest';

  const [rows, departments, people] = await Promise.all([
    listTasks({
      layer,
      search: sp.q,
      priority,
      status,
      deptId: sp.dept || undefined,
      includeDone: status?.includes('done') ?? false,
      sort,
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
          <nav className="segmented">
            {VIEWS.map((v) => (
              <Link
                key={v}
                href={query({ view: v })}
                aria-current={v === view ? 'page' : undefined}
              >
                {VIEW_LABEL[v]}
              </Link>
            ))}
          </nav>
        }
      />

      {/*
        The search, where he reaches for it: at the top, big enough to type
        into without aiming. The rest of the filters sit below, because they
        are chosen occasionally and this is used constantly.
      */}
      <SearchBox size="lg" placeholder="Find a task — title or description" className="max-w-xl" />

      <TaskFilters
        departments={departments.map((d) => ({ id: d.id, label: d.nameHe }))}
        current={{
          layer: sp.layer ?? 'all',
          q: sp.q ?? '',
          priority: sp.priority ?? '',
          status: sp.status ?? '',
          dept: sp.dept ?? '',
          sort,
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

      <TaskViewSwitch
        view={view}
        rows={rows}
        people={people.map((p) => ({ id: p.id, label: p.name }))}
        departments={departments.map((d) => ({ id: d.id, label: d.nameHe }))}
      />
    </div>
  );
}

function TaskViewSwitch({
  view,
  rows,
  people,
  departments,
}: {
  view: View;
  rows: TaskRow[];
  people: { id: string; label: string }[];
  departments: { id: string; label: string }[];
}) {
  if (view === 'board') return <TaskBoardView rows={rows} people={people} departments={departments} />;
  if (view === 'calendar') return <TaskCalendarView rows={rows} today={todayInTz()} />;
  return <TaskListView rows={rows} people={people} departments={departments} />;
}
