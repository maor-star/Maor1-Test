import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db, taskComments } from '@/lib/db';
// The shape and the naming rule live apart, because the panel that draws them
// runs in the browser; re-exported so server code has one import.
export { authorLabel, type TaskUpdate, type UpdateTrail } from './update-shape';
import type { TaskUpdate, UpdateTrail } from './update-shape';

/**
 * What has happened on a task since it was written.
 *
 * The updates already existed — they just lived only on the task's own page,
 * which meant writing one cost a trip off the board and back, and reading one
 * meant opening the task to find out nothing had happened. So the board never
 * showed them and he never wrote them.
 *
 * Fetched for the whole list at once, like the assignees and the chases: the
 * board draws two hundred rows, and a query per row is two hundred round
 * trips before the page renders.
 */
/** How many the board's panel carries before it starts saying "and N more". */
export const BOARD_UPDATES = 4;

export async function updatesForMany(
  taskIds: string[],
  perTask = BOARD_UPDATES,
): Promise<Map<string, UpdateTrail>> {
  const out = new Map<string, UpdateTrail>();
  if (taskIds.length === 0) return out;

  const rows = await db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      author: taskComments.author,
      body: taskComments.body,
      createdAt: taskComments.createdAt,
    })
    .from(taskComments)
    .where(inArray(taskComments.taskId, taskIds))
    .orderBy(desc(taskComments.createdAt));

  const counts = await db
    .select({ taskId: taskComments.taskId, total: sql<number>`count(*)::int` })
    .from(taskComments)
    .where(inArray(taskComments.taskId, taskIds))
    .groupBy(taskComments.taskId);
  const totalByTask = new Map(counts.map((c) => [c.taskId, c.total]));

  for (const { taskId, ...update } of rows) {
    const held = out.get(taskId);
    if (held) {
      if (held.latest.length < perTask) held.latest.push(update);
    } else {
      out.set(taskId, { latest: [update], total: totalByTask.get(taskId) ?? 1 });
    }
  }
  return out;
}

/** Every update on one task, oldest first — how a page reads a history. */
export async function updatesFor(taskId: string): Promise<TaskUpdate[]> {
  return db
    .select({
      id: taskComments.id,
      author: taskComments.author,
      body: taskComments.body,
      createdAt: taskComments.createdAt,
    })
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId))
    .orderBy(taskComments.createdAt);
}
