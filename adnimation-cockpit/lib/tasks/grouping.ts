import { PRIORITY_META, STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from '@/lib/tasks/types';

/**
 * Tasks in groups, the way he reads them in Monday.
 *
 * The list was a stack of cards — one task, all of its facts, then the next
 * task. That reads well for five tasks and badly for fifty: nothing lines up,
 * so "who has the most open work" or "what is overdue" means scrolling and
 * holding it in your head.
 *
 * Monday's answer, and now this one: rows in a table under a coloured group
 * bar, with a bar per group showing the mix of statuses inside it. The group
 * heading answers the question before he reads a single row.
 *
 * Which column the groups come from is his to change, because that is the
 * whole point — grouping by owner asks "who is carrying what", by due date
 * asks "what is late", by status asks "what is stuck". Same rows, different
 * question.
 *
 * No database here on purpose: this is the arithmetic behind the screen and it
 * is tested against plain objects.
 */

export const TASK_GROUP_BYS = ['status', 'owner', 'dept', 'due', 'priority'] as const;
export type TaskGroupBy = (typeof TASK_GROUP_BYS)[number];

export const GROUP_BY_LABEL: Record<TaskGroupBy, string> = {
  status: 'STATUS',
  owner: 'OWNER',
  dept: 'DEPARTMENT',
  due: 'DUE',
  priority: 'PRIORITY',
};

export const isGroupBy = (v: unknown): v is TaskGroupBy =>
  typeof v === 'string' && (TASK_GROUP_BYS as readonly string[]).includes(v);

/**
 * The colours a group bar can take.
 *
 * Named by meaning rather than by hue, so a status and a priority that mean
 * the same kind of thing — this is fine, this needs you — look the same on a
 * screen he scans rather than reads.
 */
export type GroupTone = 'done' | 'working' | 'stuck' | 'waiting' | 'idle' | 'later';

export const GROUP_COLOR: Record<GroupTone, string> = {
  done: '#16a34a',
  working: '#f97316',
  stuck: '#dc2626',
  waiting: '#0ea5e9',
  idle: '#94a3b8',
  later: '#8b5cf6',
};

const STATUS_TONE: Record<TaskStatus, GroupTone> = {
  open: 'idle',
  in_progress: 'working',
  blocked: 'stuck',
  delegated: 'waiting',
  done: 'done',
};

const PRIORITY_TONE: Record<TaskPriority, GroupTone> = {
  P0: 'stuck',
  P1: 'working',
  P2: 'waiting',
  P3: 'idle',
};

/** The tone a status carries wherever it is shown. */
export const toneForStatus = (status: string): GroupTone =>
  STATUS_TONE[status as TaskStatus] ?? 'idle';

export const toneForPriority = (priority: string): GroupTone =>
  PRIORITY_TONE[priority as TaskPriority] ?? 'idle';

/** The least a row has to carry to be grouped. */
export interface Groupable {
  id: string;
  status: string;
  priority: string;
  dueDate: string | null;
  ownerName: string | null;
  deptNameHe: string | null;
}

export interface TaskGroup<T> {
  key: string;
  label: string;
  tone: GroupTone;
  rows: T[];
  /** How the statuses inside it divide up, biggest first — the group's bar. */
  mix: { status: string; label: string; tone: GroupTone; count: number; share: number }[];
  /** Done over total, for the figure beside the bar. */
  doneShare: number;
}

/**
 * Which bucket a due date falls in.
 *
 * "This week" is the next seven days rather than the calendar week: on a
 * Thursday, a calendar week has almost nothing left in it, and the question he
 * is asking is "what is coming at me", not "what happens before Sunday".
 */
export function dueBucket(due: string | null, today: string): 'overdue' | 'today' | 'week' | 'later' | 'none' {
  if (!due) return 'none';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  const inAWeek = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  return due <= inAWeek ? 'week' : 'later';
}

const DUE_META: Record<string, { label: string; tone: GroupTone; order: number }> = {
  overdue: { label: 'OVERDUE', tone: 'stuck', order: 0 },
  today: { label: 'TODAY', tone: 'working', order: 1 },
  week: { label: 'THIS WEEK', tone: 'waiting', order: 2 },
  later: { label: 'LATER', tone: 'later', order: 3 },
  none: { label: 'NO DATE', tone: 'idle', order: 4 },
};

/** An empty bucket sorts last whatever it is called. */
const UNSET = '￿';

function bucketOf<T extends Groupable>(row: T, by: TaskGroupBy, today: string) {
  switch (by) {
    case 'status': {
      const i = (TASK_STATUSES as readonly string[]).indexOf(row.status);
      return {
        key: row.status,
        label: STATUS_LABEL[row.status as TaskStatus] ?? row.status.toUpperCase(),
        tone: toneForStatus(row.status),
        sort: String(i === -1 ? 99 : i).padStart(2, '0'),
      };
    }
    case 'priority': {
      const i = (TASK_PRIORITIES as readonly string[]).indexOf(row.priority);
      return {
        key: row.priority,
        label: `${row.priority} · ${PRIORITY_META[row.priority as TaskPriority]?.label ?? ''}`.trim(),
        tone: toneForPriority(row.priority),
        sort: String(i === -1 ? 99 : i).padStart(2, '0'),
      };
    }
    case 'owner': {
      const name = row.ownerName?.trim();
      return {
        key: name || 'unassigned',
        label: name || 'UNASSIGNED',
        tone: (name ? 'waiting' : 'idle') as GroupTone,
        sort: name ? name.toLowerCase() : UNSET,
      };
    }
    case 'dept': {
      const name = row.deptNameHe?.trim();
      return {
        key: name || 'none',
        label: name || 'NO DEPARTMENT',
        tone: (name ? 'later' : 'idle') as GroupTone,
        sort: name ? name.toLowerCase() : UNSET,
      };
    }
    case 'due': {
      const b = dueBucket(row.dueDate, today);
      const meta = DUE_META[b]!;
      return { key: b, label: meta.label, tone: meta.tone, sort: String(meta.order) };
    }
  }
}

/**
 * The rows, in groups, in the order the groups should be read.
 *
 * Order is part of the answer: statuses run in workflow order, priorities from
 * burning down, due dates from late forward. Owners and departments are
 * alphabetical because no order is truer than another — except that whatever
 * has nobody and no date sorts last, since an empty bucket is the one he is
 * least likely to be looking for.
 */
export function groupTasks<T extends Groupable>(
  rows: readonly T[],
  by: TaskGroupBy,
  today: string,
): TaskGroup<T>[] {
  const buckets = new Map<string, { label: string; tone: GroupTone; sort: string; rows: T[] }>();

  for (const row of rows) {
    const b = bucketOf(row, by, today);
    const found = buckets.get(b.key) ?? { label: b.label, tone: b.tone, sort: b.sort, rows: [] };
    found.rows.push(row);
    buckets.set(b.key, found);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[1].sort.localeCompare(b[1].sort))
    .map(([key, b]) => ({
      key,
      label: b.label,
      tone: b.tone,
      rows: b.rows,
      mix: statusMix(b.rows),
      doneShare: b.rows.length === 0 ? 0 : b.rows.filter((r) => r.status === 'done').length / b.rows.length,
    }));
}

/**
 * How a group's statuses divide up — Monday's battery.
 *
 * The one device on that screen that answers a question without being read:
 * a group that is mostly green is finished, one with a red band in it has
 * something stuck in it, and he can see which from across the room.
 *
 * In workflow order rather than by size, so the bar means the same thing in
 * every group and the eye can compare two of them.
 */
export function statusMix<T extends Groupable>(rows: readonly T[]) {
  if (rows.length === 0) return [];
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);

  const order = (s: string) => {
    const i = (TASK_STATUSES as readonly string[]).indexOf(s);
    return i === -1 ? 99 : i;
  };

  return [...counts.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([status, count]) => ({
      status,
      label: STATUS_LABEL[status as TaskStatus] ?? status.toUpperCase(),
      tone: toneForStatus(status),
      count,
      share: count / rows.length,
    }));
}
