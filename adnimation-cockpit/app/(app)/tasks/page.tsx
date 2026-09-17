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
import { TaskGroupedView } from '@/components/tasks/grouped-view';
import { TaskBoardView } from '@/components/tasks/board-view';
import { TaskCalendarView } from '@/components/tasks/calendar-view';
import { TaskFilters } from '@/components/tasks/filters';
import { NewTaskForm } from '@/components/tasks/new-task-form';
import { linesForMany, pillarOptions } from '@/lib/control/tagging';
import { mailForMany, type MailLink } from '@/lib/tasks/mail-links';
import { PillarFilter } from '@/components/hud/pillar-filter';
import { GROUP_BY_LABEL, isGroupBy, TASK_GROUP_BYS, type TaskGroupBy } from '@/lib/tasks/grouping';
import { delegationsForMany, type DelegationMark } from '@/lib/delegation/for-many';
import { assigneesForMany, type AssigneeChip } from '@/lib/tasks/assignees';
import { lastNudges, type NudgeMark } from '@/lib/tasks/nudge';
import { requireUser } from '@/lib/auth/session';
import { canManageAccess, canSeePrivate, isAccountHolder } from '@/lib/tasks/access';
import { listGrants } from '@/lib/tasks/access-service';
import { TaskAccessPanel } from '@/components/tasks/access-panel';
import { pendingInvites } from '@/lib/tasks/invite-service';
import { peopleByUse } from '@/lib/tasks/people-order';
import { updatesForMany } from '@/lib/tasks/updates';
import type { UpdateTrail } from '@/lib/tasks/update-shape';

export const dynamic = 'force-dynamic';

/**
 * Four ways to read the same tasks.
 *
 * `table` is the default and is the one he asked for: rows in groups, the way
 * he reads them in Monday. `list` is the card stack it replaced — kept because
 * a card carries the description, the attachments and the money, which no
 * table row has room for.
 */
const VIEWS = ['table', 'list', 'board', 'calendar'] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABEL: Record<View, string> = {
  table: 'TABLE',
  list: 'CARDS',
  board: 'BOARD',
  calendar: 'CALENDAR',
};

interface SearchParams {
  view?: string;
  group?: string;
  layer?: string;
  q?: string;
  priority?: string;
  status?: string;
  dept?: string;
  sort?: string;
  pillar?: string;
}

/** Spec 6.1.1 / 6.4 — my tasks and the ClickUp mirror, in three views. */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const viewer = await requireUser();
  const view: View = VIEWS.includes(sp.view as View) ? (sp.view as View) : 'table';
  /*
   * Which column the groups come from. Status by default, because that is the
   * question the screen is usually open to answer — grouping by owner asks who
   * is carrying what, by due date asks what is late. Same rows, different
   * question, and it lives in the URL so a narrowed screen is a link.
   */
  const groupBy: TaskGroupBy = isGroupBy(sp.group) ? sp.group : 'status';
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

  const [all, departments, people] = await Promise.all([
    listTasks({
      // The starred ones come back only for him. Everybody else — the
      // operator included — never receives them from the database at all.
      canSeePrivate: canSeePrivate(viewer),
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

  /*
   * The guest list, and whether this viewer is the one who keeps it. Loaded
   * only for him — nobody else has anything to do with it, and it is not a
   * list a guest should be able to read.
   */
  const grants = canManageAccess(viewer) ? await listGrants() : [];
  const invites = canManageAccess(viewer) ? await pendingInvites() : [];

  // Which pillars each task belongs to, and who is holding it — one query
  // each for the whole list rather than one per row.
  const ids = all.map((r) => r.id);
  const [pillars, delegated, assignees, nudges, updates, ranked, mail] = await Promise.all([
    linesForMany('task', ids),
    delegationsForMany('task', ids),
    assigneesForMany(ids),
    lastNudges(ids),
    // What has been written on each, newest first — one query for the board.
    updatesForMany(ids),
    // The team in the order he actually uses them, so the picker opens on the
    // four names that carry the board rather than on the alphabet.
    peopleByUse(),
    // The threads the sweep matched to each task — one query for the board.
    mailForMany(ids),
  ]);

  // One pillar at a time, and only one he actually has — the list is his to
  // edit, so what counts as a pillar is read, not compiled in.
  const pillarList = await pillarOptions();
  const pillar = pillarList.some((p) => p.line === sp.pillar) ? (sp.pillar ?? null) : null;

  // Narrowed to one pillar when he asked for one. A task nobody has tagged is
  // not an answer to "what is on Exchange CTV", so it drops out.
  const rows = pillar
    ? all.filter((t) => (pillars.get(t.id) ?? []).some((l) => l === pillar))
    : all;

  /** The same screen, read on one pillar — everything else he narrowed kept. */
  const pillarHref = (line: string | null) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (key !== 'pillar' && typeof value === 'string' && value) params.set(key, value);
    }
    if (line) params.set('pillar', line);
    const query = params.toString();
    return query ? `/tasks?${query}` : '/tasks';
  };

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
        kicker="TASKS / 02"
        title="Tasks"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canManageAccess(viewer) ? (
              <TaskAccessPanel
                grants={grants}
                invites={invites}
                people={people
                  .filter((p) => !p.email.endsWith('@slack.local'))
                  .map((p) => ({ id: p.id, label: p.name, email: p.email }))}
              />
            ) : null}
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
          </div>
        }
      />

      {/*
        The search, where he reaches for it: at the top, big enough to type
        into without aiming. The rest of the filters sit below, because they
        are chosen occasionally and this is used constantly.
      */}
      <SearchBox size="lg" placeholder="Find a task — title or description" className="max-w-xl" />

      {/* The whole company by department: the same list, read one pillar at a
          time, in the URL so a narrowed screen is a link he can send. */}
      <PillarFilter
        current={pillar}
        href={pillarHref}
        options={pillarList}
        // A guest reads the board; the list itself is his.
        manage={canManageAccess(viewer) ? '/settings/pillars' : undefined}
      />

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
          people={ranked}
        />
      </HudCard>

      {/* Only the table has groups, so the selector only appears with it —
          a control that does nothing on three views out of four is a control
          he learns to ignore. */}
      {view === 'table' ? (
        <nav className="segmented" aria-label="Group by">
          {TASK_GROUP_BYS.map((g) => (
            <Link
              key={g}
              href={query({ group: g })}
              aria-current={g === groupBy ? 'page' : undefined}
            >
              {GROUP_BY_LABEL[g]}
            </Link>
          ))}
        </nav>
      ) : null}

      <TaskViewSwitch
        view={view}
        rows={rows}
        people={ranked}
        departments={departments.map((d) => ({ id: d.id, label: d.nameHe }))}
        lines={pillars}
        mail={mail}
        canReadMail={isAccountHolder(viewer)}
        groupBy={groupBy}
        today={todayInTz()}
        delegated={delegated}
        assignees={assignees}
        nudges={nudges}
        updates={updates}
        roster={people.map((p) => ({ email: p.email, name: p.name }))}
        canStar={canManageAccess(viewer)}
      />
    </div>
  );
}

function TaskViewSwitch({
  view,
  rows,
  people,
  departments,
  lines,
  mail,
  canReadMail,
  groupBy,
  today,
  delegated,
  assignees,
  nudges,
  updates,
  roster,
  canStar,
}: {
  view: View;
  rows: TaskRow[];
  people: { id: string; label: string }[];
  departments: { id: string; label: string }[];
  lines?: Map<string, string[]>;
  /** Task id → the emails the sweep matched to it. */
  mail?: Map<string, MailLink[]>;
  /** His mailbox is not part of what a guest on this board is granted. */
  canReadMail: boolean;
  groupBy: TaskGroupBy;
  today: string;
  delegated: Map<string, DelegationMark>;
  assignees: Map<string, AssigneeChip[]>;
  nudges: Map<string, NudgeMark>;
  updates: Map<string, UpdateTrail>;
  roster: { email: string; name: string }[];
  canStar: boolean;
}) {
  if (view === 'board') return <TaskBoardView rows={rows} people={people} departments={departments} />;
  if (view === 'calendar') return <TaskCalendarView rows={rows} today={today} />;
  if (view === 'list') {
    return (
      <TaskListView
        rows={rows}
        people={people}
        departments={departments}
        lines={lines}
        assignees={assignees}
        mail={mail}
        canReadMail={canReadMail}
      />
    );
  }
  return (
    <TaskGroupedView
      rows={rows}
      people={people}
      departments={departments}
      groupBy={groupBy}
      today={today}
      lines={lines}
      mail={mail}
      canReadMail={canReadMail}
      delegated={delegated}
      assignees={assignees}
      nudges={nudges}
      updates={updates}
      roster={roster}
      canStar={canStar}
    />
  );
}
