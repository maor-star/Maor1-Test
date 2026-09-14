import { and, eq, inArray, asc } from 'drizzle-orm';
import { db, people, taskAssignees, tasks } from '@/lib/db';
// Re-exported so server code has one import for all of this; the rule itself
// lives apart because the rows that use it are drawn in the browser.
export { chipsFor, type AssigneeChip } from './assignee-chip';

/**
 * Who is on a task.
 *
 * The board carried one owner, because the first ClickUp assignee was all the
 * mirror kept — so a task two people share showed one name and lost the other,
 * and "who is carrying this" had a wrong answer on every shared task.
 *
 * There are two places a name can live and they must not be allowed to
 * disagree, so the rule is written once, here:
 *
 *   · `task_assignees` holds EVERYONE, in the order he picked them.
 *   · `tasks.owner_person_id` is the LEAD — position 0, the first of them.
 *     Heat scoring, grouping by owner and the ClickUp mirror all read it, and
 *     a row has to sort under one name.
 *
 * Every write goes through `setAssignees`, which sets both in one go. Nothing
 * else writes `owner_person_id` for a task with assignees.
 */
export interface Assignee {
  id: string;
  name: string;
  email: string;
  slackId: string | null;
}

/** Everyone on one task, lead first. */
export async function assigneesOf(taskId: string): Promise<Assignee[]> {
  const rows = await db
    .select({
      id: people.id,
      name: people.name,
      email: people.email,
      slackId: people.slackId,
      position: taskAssignees.position,
    })
    .from(taskAssignees)
    .innerJoin(people, eq(people.id, taskAssignees.personId))
    .where(eq(taskAssignees.taskId, taskId))
    .orderBy(asc(taskAssignees.position), asc(people.name));
  return rows.map(({ position: _position, ...person }) => person);
}

/**
 * Everyone on each of many tasks, in one query.
 *
 * The board draws two hundred rows, and a query per row is two hundred
 * round-trips before the page renders — the same reason the delegation marks
 * are fetched for the whole list at once.
 */
export async function assigneesForMany(taskIds: string[]): Promise<Map<string, Assignee[]>> {
  const out = new Map<string, Assignee[]>();
  if (taskIds.length === 0) return out;

  const rows = await db
    .select({
      taskId: taskAssignees.taskId,
      id: people.id,
      name: people.name,
      email: people.email,
      slackId: people.slackId,
      position: taskAssignees.position,
    })
    .from(taskAssignees)
    .innerJoin(people, eq(people.id, taskAssignees.personId))
    .where(inArray(taskAssignees.taskId, taskIds))
    .orderBy(asc(taskAssignees.position), asc(people.name));

  for (const { taskId, position: _position, ...person } of rows) {
    const list = out.get(taskId);
    if (list) list.push(person);
    else out.set(taskId, [person]);
  }
  return out;
}

/**
 * Sets exactly who is on a task, and makes the first of them the lead.
 *
 * Ids that are repeated or empty are dropped rather than rejected: they come
 * from a multi-select, and a duplicate there is a slip of the mouse and not
 * something to refuse a save over.
 *
 * Returns the lead, so the caller can write it wherever it also keeps one.
 */
export async function setAssignees(taskId: string, personIds: string[]): Promise<string | null> {
  const wanted: string[] = [];
  for (const raw of personIds) {
    const id = raw.trim();
    if (id && !wanted.includes(id)) wanted.push(id);
  }

  // Only people who exist, in the order he picked them — a stale id from an
  // open tab must not become an assignee nobody can resolve to a name.
  const known =
    wanted.length === 0
      ? []
      : await db.select({ id: people.id }).from(people).where(inArray(people.id, wanted));
  const ids = wanted.filter((id) => known.some((p) => p.id === id));

  await db.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
  if (ids.length > 0) {
    await db
      .insert(taskAssignees)
      .values(ids.map((personId, position) => ({ taskId, personId, position })))
      .onConflictDoNothing();
  }

  return ids[0] ?? null;
}

/**
 * Keeps the two in step when only the lead is set — the mirror's path.
 *
 * The ClickUp poll writes `owner_person_id` directly and knows nothing about
 * this table, so without this a mirrored task would show its owner on the row
 * and nobody in the picker.
 */
export async function syncLeadFromOwner(taskId: string): Promise<void> {
  const [task] = await db
    .select({ owner: tasks.ownerPersonId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task?.owner) return;

  const [already] = await db
    .select({ personId: taskAssignees.personId })
    .from(taskAssignees)
    .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.personId, task.owner)))
    .limit(1);
  if (already) return;

  await db
    .insert(taskAssignees)
    .values({ taskId, personId: task.owner, position: 0 })
    .onConflictDoNothing();
}
