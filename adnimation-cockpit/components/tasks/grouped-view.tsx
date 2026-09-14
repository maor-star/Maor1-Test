'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { TaskRow } from '@/lib/tasks/queries';
import { TASK_PRIORITIES, PRIORITY_META, statusOptionsFor } from '@/lib/tasks/types';
import {
  GROUP_COLOR, groupTasks, toneForPriority, toneForStatus,
  type TaskGroup, type TaskGroupBy,
} from '@/lib/tasks/grouping';
import { CellDate, CellSelect } from '@/components/tasks/cell-select';
import { DelegateCell } from '@/components/hud/delegate-cell';
import { StarCell } from '@/components/tasks/star-cell';
import { QuickEditPanel, QuickEditToggle } from '@/components/tasks/quick-edit';
import type { DelegationMark } from '@/lib/delegation/for-many';
import { InstantFilter } from '@/components/hud/instant-filter';
import { Num } from '@/components/num';
import { foldForSearch } from '@/lib/search';

/**
 * Every task, in groups, the way he reads them in Monday.
 *
 * The list was a stack of cards: one task with all of its facts, then the next
 * one. Nothing lined up, so any question across tasks — who is carrying the
 * most, what is late, what is stuck — meant scrolling and holding it in his
 * head.
 *
 * This is the other shape. Rows in a table under a coloured group bar, each
 * group carrying the bar that shows the mix of statuses inside it, and every
 * cell editable where it sits. Changing a status is clicking the status.
 *
 * The title still opens the task, because the long fields — description, next
 * step, comments, attachments — belong on a page and not in a cell.
 */

/** The columns, and the width each one gets. Owner and status carry the eye. */
const COLS_OWNER = '2rem minmax(0,1fr) 9rem 9.5rem 8.5rem 8rem 8rem 9rem 1.75rem';
const COLS_GUEST = 'minmax(0,1fr) 9rem 9.5rem 8.5rem 8rem 8rem 9rem 1.75rem';

export function TaskGroupedView({
  rows,
  people,
  departments,
  groupBy,
  today,
  delegated,
  canStar,
}: {
  rows: TaskRow[];
  people: { id: string; label: string }[];
  departments: { id: string; label: string }[];
  groupBy: TaskGroupBy;
  today: string;
  /** Task id → who is holding it, fetched for the whole list at once. */
  delegated: Map<string, DelegationMark>;
  /**
   * Whether the star is his to press. Only the owner marks a task private, so
   * for anyone else the column is not there at all rather than disabled — a
   * task they can see is by definition one that is not private.
   */
  canStar: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="hud-card p-6 text-center text-[14.5px] text-muted">
        No tasks match this filter.
      </div>
    );
  }

  const groups = groupTasks(rows, groupBy, today);

  /*
   * Every status on the board is offered, not only the five the cockpit knows.
   *
   * Most tasks here are mirrored from ClickUp and carry that list's own words —
   * MAKE IT HAPPENED and STUCK among them. Offering only the cockpit's five
   * made a `<select>` whose value matched no option, and a browser shows the
   * first option when that happens: thirty-one rows read OPEN while holding
   * something else.
   */
  const statusOptions = statusOptionsFor(rows.map((r) => r.status));
  const priorityOptions = TASK_PRIORITIES.map((p) => ({
    value: p,
    label: `${p} ${PRIORITY_META[p].label}`,
  }));
  const ownerOptions = [{ value: '', label: 'UNASSIGNED' }, ...people.map((p) => ({ value: p.id, label: p.label }))];
  const deptOptions = [{ value: '', label: 'NO DEPARTMENT' }, ...departments.map((d) => ({ value: d.id, label: d.label }))];

  return (
    <div className="space-y-3" id="task-list">
      {/* The list narrows as he types, before the URL has caught up. */}
      <InstantFilter scope="task-list" />
      {groups.map((g) => (
        <Group
          key={g.key}
          group={g}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          ownerOptions={ownerOptions}
          deptOptions={deptOptions}
          today={today}
          people={people}
          delegated={delegated}
          canStar={canStar}
        />
      ))}
      <p className="px-1 text-[12.5px] text-muted">
        <Num>{rows.length}</Num> tasks in <Num>{groups.length}</Num> groups ·{' '}
        <Link href="/delegations" className="font-semibold text-info hover:underline">
          Delegation tracker
        </Link>
      </p>
    </div>
  );
}

function Group({
  group,
  statusOptions,
  priorityOptions,
  ownerOptions,
  deptOptions,
  today,
  people,
  delegated,
  canStar,
}: {
  group: TaskGroup<TaskRow>;
  statusOptions: { value: string; label: string }[];
  priorityOptions: { value: string; label: string }[];
  ownerOptions: { value: string; label: string }[];
  deptOptions: { value: string; label: string }[];
  today: string;
  people: { id: string; label: string }[];
  delegated: Map<string, DelegationMark>;
  canStar: boolean;
}) {
  const [open, setOpen] = useState(true);
  const colour = GROUP_COLOR[group.tone];

  return (
    <section className="hud-card overflow-hidden p-0">
      {/* The group heading: its colour, its name, how many, and the mix. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-[14px] py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-start"
        >
          <span
            aria-hidden
            className="inline-block h-[18px] w-[4px] shrink-0 rounded-full"
            style={{ background: colour }}
          />
          <span className="hud-label truncate text-[12.5px]" style={{ color: colour }}>
            {group.label}
          </span>
          <span className="text-[12px] text-muted">
            <Num>{group.rows.length}</Num>
          </span>
          <span aria-hidden className="text-[11px] text-muted">
            {open ? '▾' : '▸'}
          </span>
        </button>

        <StatusBar group={group} />
      </header>

      {open ? (
        <>
          <div
            className="hidden border-b border-line px-[14px] py-1.5 md:grid"
            style={{ gridTemplateColumns: canStar ? COLS_OWNER : COLS_GUEST }}
          >
            {(canStar
              ? ['', 'TASK', 'OWNER', 'STATUS', 'PRIORITY', 'DUE', 'DEPARTMENT', 'DELEGATED TO', ' ']
              : ['TASK', 'OWNER', 'STATUS', 'PRIORITY', 'DUE', 'DEPARTMENT', 'DELEGATED TO', ' ']
            ).map((h) => (
              <span
                key={h.trim() || (h === '' ? 'star' : 'edit')}
                className={`hud-label text-[10.5px] ${h === 'TASK' ? 'text-start' : 'text-center'}`}
                title={h === '' ? 'Private' : undefined}
              >
                {h === '' ? '★' : h}
              </span>
            ))}
          </div>

          <ul>
            {group.rows.map((t) => (
              <Row
                key={t.id}
                task={t}
                statusOptions={statusOptions}
                priorityOptions={priorityOptions}
                ownerOptions={ownerOptions}
                deptOptions={deptOptions}
                today={today}
                people={people}
                mark={delegated.get(t.id)}
                canStar={canStar}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/**
 * The mix of statuses in a group — Monday's battery.
 *
 * The one device on that screen that answers without being read: a group that
 * is all green is finished, one with a red band has something stuck in it, and
 * he can tell which from across the room. In workflow order rather than by
 * size, so two groups can be compared at a glance.
 */
function StatusBar({ group }: { group: TaskGroup<TaskRow> }) {
  return (
    <span className="flex min-w-[9rem] flex-1 items-center gap-2">
      <span className="flex h-[8px] flex-1 overflow-hidden rounded-full bg-neutral-200">
        {group.mix.map((m) => (
          <span
            key={m.key}
            title={`${m.label}: ${m.count}`}
            style={{ width: `${m.share * 100}%`, background: GROUP_COLOR[m.tone] }}
          />
        ))}
      </span>
      <span className="shrink-0 font-mono text-[11.5px] text-muted">
        <Num>{`${Math.round(group.doneShare * 100)}%`}</Num>
      </span>
    </span>
  );
}

function Row({
  task,
  statusOptions,
  priorityOptions,
  ownerOptions,
  deptOptions,
  today,
  people,
  mark,
  canStar,
}: {
  task: TaskRow;
  statusOptions: { value: string; label: string }[];
  priorityOptions: { value: string; label: string }[];
  ownerOptions: { value: string; label: string }[];
  deptOptions: { value: string; label: string }[];
  today: string;
  people: { id: string; label: string }[];
  mark: DelegationMark | undefined;
  canStar: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const overdue = task.dueDate !== null && task.dueDate < today && task.status !== 'done';
  const statusColour = GROUP_COLOR[toneForStatus(task.status)];
  const priorityColour = GROUP_COLOR[toneForPriority(task.priority)];

  return (
    <>
    <li
      data-search={foldForSearch(
        task.title,
        task.description,
        task.nextStep,
        task.ownerName,
        task.deptNameHe,
        task.status,
        task.priority,
        task.dueDate,
        // So searching a colleague's name finds what he handed them.
        mark?.personName,
        ...task.tags,
      )}
      className="grid items-center gap-x-2 gap-y-1 border-b border-line px-[14px] py-1.5 last:border-b-0 hover:bg-neutral-50 md:gap-y-0"
      style={{ gridTemplateColumns: canStar ? COLS_OWNER : COLS_GUEST }}
    >
      {canStar ? <StarCell taskId={task.id} isPrivate={task.isPrivate} /> : null}

      <span className="col-span-full min-w-0 md:col-span-1">
        <Link
          href={`/tasks/${task.id}`}
          className="block truncate font-cond text-[15px] text-neutral-900 hover:text-accent"
          title={task.title}
        >
          {task.title}
        </Link>
        {task.nextStep ? (
          <span className="block truncate text-[11.5px] text-muted" title={task.nextStep}>
            → {task.nextStep}
          </span>
        ) : null}
      </span>

      <CellSelect
        taskId={task.id}
        field="ownerPersonId"
        value={task.ownerPersonId ?? ''}
        options={ownerOptions}
        title="Owner"
        className="text-[11.5px] text-ink"
      />

      {/* Monday fills the whole status cell with the colour. It is the thing
          the eye lands on, and the reason the row can be read without being
          read. */}
      <CellSelect
        taskId={task.id}
        field="status"
        value={task.status}
        options={statusOptions}
        title="Status"
        className="rounded-[6px] text-white"
        style={{ background: statusColour }}
      />

      <CellSelect
        taskId={task.id}
        field="priority"
        value={task.priority}
        options={priorityOptions}
        title="Priority"
        className="rounded-[6px] text-white"
        style={{ background: priorityColour }}
      />

      <span className={overdue ? 'rounded-[6px] bg-neg/10 ring-1 ring-inset ring-neg/40' : ''}>
        <CellDate taskId={task.id} field="dueDate" value={task.dueDate} title="Due date" />
      </span>

      <CellSelect
        taskId={task.id}
        field="deptId"
        value={task.deptId ?? ''}
        options={deptOptions}
        title="Department"
        className="text-[11.5px] text-ink"
      />

      {/* Whether he passed it on, and to whom. Nothing on the row said this
          before, so a task he delegated on Tuesday looked exactly like one
          nobody had touched. */}
      <DelegateCell
        mark={mark}
        entityId={task.id}
        entityType="task"
        title={task.title}
        people={people}
      />

      {/* Everything the row has no column for — description, next step, start
          date, tags, money — without leaving the list. */}
      <QuickEditToggle
        open={editing}
        title={task.title}
        onToggle={() => setEditing((v) => !v)}
      />
    </li>

    {editing ? (
      <li className="border-b border-line last:border-b-0">
        <QuickEditPanel
          task={task}
          statusOptions={statusOptions}
          ownerOptions={ownerOptions}
          deptOptions={deptOptions}
          onClose={() => setEditing(false)}
        />
      </li>
    ) : null}
    </>
  );
}
