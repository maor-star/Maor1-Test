/**
 * Who to draw on a row.
 *
 * Its own module, and the reason is the build: the table that draws these is a
 * client component, and a client component that reaches lib/db — even through
 * three re-exports — fails the build with "Can't resolve 'net'". So the rule
 * lives here with nothing under it, and lib/tasks/assignees.ts, which does
 * touch the database, re-exports it for the server.
 */
/** Just enough of a person to draw them on a row. */
export interface AssigneeChip {
  id: string;
  name: string;
}

/**
 * Who to draw on a row, given what the assignees table had for it.
 *
 * A mirrored task arrives from ClickUp with an owner and no row in
 * `task_assignees` — the poll knows nothing about that table — so an empty
 * answer there means "the lead alone", not "nobody". The rule has to live in
 * one place or the row and the picker will disagree about a task he has never
 * edited, which is most of them.
 *
 * Once he does edit one, the table is the whole truth: setAssignees writes
 * every name and clears the owner when he removes the last, so an empty table
 * with no owner really is nobody.
 */
export function chipsFor(
  task: { ownerPersonId: string | null; ownerName: string | null },
  found: readonly AssigneeChip[] | undefined,
): AssigneeChip[] {
  if (found && found.length > 0) return found.map((a) => ({ id: a.id, name: a.name }));
  if (task.ownerPersonId && task.ownerName) {
    return [{ id: task.ownerPersonId, name: task.ownerName }];
  }
  return [];
}
