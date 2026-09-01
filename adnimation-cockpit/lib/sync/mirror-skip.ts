/**
 * Whose ClickUp tasks are not his.
 *
 * The mirror pulled every open task in the workspace, which put 60 of Mor's
 * and Tomer's on his screen — work he neither does nor tracks. A list that is
 * two thirds other people's work is a list he stops reading, so those never
 * arrive at all rather than being filtered after the fact.
 *
 * The rule is deliberately narrow. A task is skipped only when everyone on it
 * is on the skip list: a task he shares with Mor is still his to see, and an
 * unassigned task is nobody's to hide. Getting this backwards would drop work
 * silently, which is the one failure a task list must not have.
 *
 * The list itself is configuration, not code — TASK_MIRROR_SKIP, comma
 * separated — so changing who is excluded is a setting, not a deploy.
 */

export const DEFAULT_SKIP = ['mor@adnimation.com', 'treves@adnimation.com'];

export function skipList(raw: string | undefined = process.env.TASK_MIRROR_SKIP): string[] {
  if (raw === undefined) return DEFAULT_SKIP;
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function shouldMirror(assigneeEmails: string[], skip: string[] = skipList()): boolean {
  if (skip.length === 0) return true;

  // Both sides are folded here rather than trusting the caller: a list built
  // by hand, or read from somewhere other than skipList, must behave the same.
  const excluded = skip.map((e) => e.trim().toLowerCase()).filter(Boolean);
  const assignees = assigneeEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);

  // Nobody is assigned: it belongs to no one, so it is not somebody else's.
  if (assignees.length === 0) return true;

  // Someone outside the list is on it — including him — so it stays.
  return assignees.some((email) => !excluded.includes(email));
}
