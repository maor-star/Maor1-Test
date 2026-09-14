import { and, asc, desc, eq, ilike, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { db, departments, people, tasks } from '@/lib/db';
import type { TaskPriority, TaskSort, TaskStatus } from './types';

export interface TaskRow {
  id: string;
  layer: 'mine' | 'company';
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: string;
  dueDate: string | null;
  startDate: string | null;
  /** Carried so the row can stop a task repeating without opening its page. */
  recurrenceRule: string | null;
  /** The next move on it, and when that move is due — see the deals board. */
  nextStep: string | null;
  nextStepDate: string | null;
  /** When it last moved. Null on a task nothing has happened to yet. */
  lastTouchAt: Date | null;
  tags: string[];
  heatScore: number;
  snoozeCount: number;
  snoozeUntil: Date | null;
  moneyImpactCents: number | null;
  blockedPeople: string[];
  parentId: string | null;
  /** Starred as his alone. */
  isPrivate: boolean;
  clickupUrl: string | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  deptCode: string | null;
  deptNameHe: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  /** The ids, not only the labels — the edit form needs something to select. */
  deptId: string | null;
  ownerPersonId: string | null;
  /** On a mirrored task, the fields the cockpit owns. */
  pinnedFields: string[];
}

const selection = {
  id: tasks.id,
  layer: tasks.layer,
  title: tasks.title,
  description: tasks.description,
  priority: tasks.priority,
  status: tasks.status,
  dueDate: tasks.dueDate,
  startDate: tasks.startDate,
  recurrenceRule: tasks.recurrenceRule,
  nextStep: tasks.nextStep,
  nextStepDate: tasks.nextStepDate,
  lastTouchAt: tasks.lastTouchAt,
  tags: tasks.tags,
  heatScore: tasks.heatScore,
  snoozeCount: tasks.snoozeCount,
  snoozeUntil: tasks.snoozeUntil,
  moneyImpactCents: tasks.moneyImpactCents,
  blockedPeople: tasks.blockedPeople,
  parentId: tasks.parentId,
  isPrivate: tasks.isPrivate,
  clickupUrl: tasks.clickupUrl,
  source: tasks.source,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
  deptCode: departments.code,
  deptNameHe: departments.nameHe,
  ownerName: people.name,
  ownerEmail: people.email,
  deptId: tasks.deptId,
  ownerPersonId: tasks.ownerPersonId,
  pinnedFields: tasks.pinnedFields,
};

const baseQuery = () =>
  db
    .select(selection)
    .from(tasks)
    .leftJoin(departments, eq(tasks.deptId, departments.id))
    .leftJoin(people, eq(tasks.ownerPersonId, people.id));

export interface TaskFilter {
  /**
   * Set only for the owner. Everything else — the operator, a collaborator, a
   * job with no session at all — leaves it unset and sees no starred tasks.
   */
  canSeePrivate?: boolean;
  layer?: 'mine' | 'company';
  status?: TaskStatus[];
  priority?: TaskPriority[];
  deptId?: string;
  ownerPersonId?: string;
  search?: string;
  /** Include tasks whose snooze window has not expired. Default: hide them. */
  includeSnoozed?: boolean;
  includeDone?: boolean;
  sort?: TaskSort;
  limit?: number;
}

/**
 * Ordering, with a tiebreak that never leaves rows in an arbitrary order.
 *
 * Two tasks with the same heat, or no due date at all, would otherwise come
 * back in whatever order the planner chose — which changes between page loads
 * and reads as the list shuffling itself while he is looking at it.
 */
function ordering(sort: TaskSort = 'newest') {
  switch (sort) {
    case 'newest':
      return [desc(tasks.createdAt)];
    case 'oldest':
      return [asc(tasks.createdAt)];
    case 'due':
      // Nulls last: a task with no date is not the most urgent thing he owns.
      return [sql`${tasks.dueDate} asc nulls last`, desc(tasks.heatScore)];
    case 'heat':
    default:
      return [desc(tasks.heatScore), sql`${tasks.dueDate} asc nulls last`, desc(tasks.createdAt)];
  }
}

export async function listTasks(filter: TaskFilter = {}): Promise<TaskRow[]> {
  const conditions = [isNull(tasks.archivedAt)];

  /*
   * A starred task never leaves the database for anybody but him.
   *
   * Filtered here rather than after the rows arrive, because a task nobody
   * else may see must not reach a page that then decides not to draw it — one
   * forgotten `.filter()` in a component, one JSON payload, one search index,
   * and it is out. The default is the strict one: a caller that says nothing
   * about who is asking gets no private tasks.
   */
  if (!filter.canSeePrivate) conditions.push(eq(tasks.isPrivate, false));

  if (filter.layer) conditions.push(eq(tasks.layer, filter.layer));
  if (filter.status?.length) conditions.push(inArray(tasks.status, filter.status));
  else if (!filter.includeDone) conditions.push(ne(tasks.status, 'done'));
  if (filter.priority?.length) conditions.push(inArray(tasks.priority, filter.priority));
  if (filter.deptId) conditions.push(eq(tasks.deptId, filter.deptId));
  if (filter.ownerPersonId) conditions.push(eq(tasks.ownerPersonId, filter.ownerPersonId));
  if (!filter.includeSnoozed) {
    conditions.push(or(isNull(tasks.snoozeUntil), lte(tasks.snoozeUntil, new Date()))!);
  }
  if (filter.search?.trim()) {
    const q = `%${filter.search.trim()}%`;
    conditions.push(or(ilike(tasks.title, q), ilike(tasks.description, q))!);
  }

  return baseQuery()
    .where(and(...conditions))
    .orderBy(...ordering(filter.sort))
    .limit(filter.limit ?? 500) as Promise<TaskRow[]>;
}

/**
 * One task by id — and not a private one unless the asker is him.
 *
 * The list is not the only way in. `/tasks/<id>` typed into the address bar
 * reaches this directly, so the same rule has to live here or the filter on
 * the list is a curtain rather than a wall.
 */
export async function getTask(id: string, canSeePrivate = false): Promise<TaskRow | null> {
  const conditions = [eq(tasks.id, id)];
  if (!canSeePrivate) conditions.push(eq(tasks.isPrivate, false));
  const [row] = await baseQuery().where(and(...conditions)).limit(1);
  return (row as TaskRow | undefined) ?? null;
}

/** Subtasks, under the same rule — a private one does not surface under a parent. */
export async function getSubtasks(parentId: string, canSeePrivate = false): Promise<TaskRow[]> {
  const conditions = [eq(tasks.parentId, parentId), isNull(tasks.archivedAt)];
  if (!canSeePrivate) conditions.push(eq(tasks.isPrivate, false));
  return baseQuery()
    .where(and(...conditions))
    .orderBy(asc(tasks.createdAt)) as Promise<TaskRow[]>;
}

/**
 * Cockpit strip 2 (spec §5) — up to seven P0/P1 tasks due today or overdue,
 * hottest first, plus a count of everything else still open.
 */
export async function burningToday(today: string, limit = 7, canSeePrivate = false) {
  const conditions = [
    isNull(tasks.archivedAt),
    ne(tasks.status, 'done'),
    inArray(tasks.priority, ['P0', 'P1'] as const),
    lte(tasks.dueDate, today),
    or(isNull(tasks.snoozeUntil), lte(tasks.snoozeUntil, new Date()))!,
  ];
  // The strip on the overview, and the morning brief behind it. A private task
  // must not appear in either for anybody but him.
  if (!canSeePrivate) conditions.push(eq(tasks.isPrivate, false));

  const rows = (await baseQuery()
    .where(and(...conditions))
    .orderBy(desc(tasks.heatScore), asc(tasks.dueDate))
    .limit(limit)) as TaskRow[];

  const [{ count = 0 } = {}] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(isNull(tasks.archivedAt), ne(tasks.status, 'done')));

  return { rows, backlogCount: Math.max(0, count - rows.length) };
}

export async function listDepartments() {
  return db.select().from(departments).where(eq(departments.active, true)).orderBy(asc(departments.code));
}

export async function listPeople() {
  return db.select().from(people).where(eq(people.active, true)).orderBy(asc(people.name));
}
