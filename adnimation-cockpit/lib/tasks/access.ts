/**
 * Who may see which tasks.
 *
 * The cockpit had exactly two accounts. He asked to open the tasks board to
 * other people while keeping some tasks to himself, so there are now two
 * separate ideas and it matters that they stay separate:
 *
 *   · a STAR on a task — private, meaning him and nobody else
 *   · a GRANT to a person — the tasks board, and nothing else in the cockpit
 *
 * The second is the one to be careful about. Letting somebody see a task list
 * must not hand them the revenue, the P&L, the contracts, the mail or the
 * pipeline. So a grant creates a role that reaches one screen, and that is
 * enforced in the middleware and in the queries — not by leaving the other
 * links out of the navigation, which hides nothing from anyone who types a URL.
 *
 * Pure on purpose. These are the decisions that must not be wrong, so they are
 * tested against plain objects with no database and no session in the way.
 */

export const ACCESS_LEVELS = ['view', 'edit'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const LEVEL_LABEL: Record<AccessLevel, string> = {
  view: 'CAN VIEW',
  edit: 'CAN EDIT',
};

export const isAccessLevel = (v: unknown): v is AccessLevel =>
  typeof v === 'string' && (ACCESS_LEVELS as readonly string[]).includes(v);

/**
 * Everyone the cockpit knows how to treat.
 *
 * `collaborator` is the new one and the narrow one: somebody he granted the
 * tasks board to, who has no account anywhere else in the system.
 */
export type Viewer = {
  email: string;
  role: 'owner' | 'operator' | 'collaborator';
  /** Set only for a collaborator; the two account roles are not granted. */
  level?: AccessLevel;
};

/** The two real accounts. Everything outside tasks is theirs alone. */
export const isAccountHolder = (viewer: Pick<Viewer, 'role'>): boolean =>
  viewer.role === 'owner' || viewer.role === 'operator';

/**
 * A starred task is his.
 *
 * "So that only I see it" — so the operator does not either. That is a
 * deliberate reading of what he asked for and the strict one; widening it to
 * his chief of staff later is a one-word change, and a private task that
 * turned out not to be private is not recoverable.
 */
export const canSeePrivate = (viewer: Pick<Viewer, 'role'>): boolean => viewer.role === 'owner';

/** Whether this viewer may see this task at all. */
export function canSeeTask(
  task: { isPrivate: boolean },
  viewer: Pick<Viewer, 'role'>,
): boolean {
  return task.isPrivate ? canSeePrivate(viewer) : true;
}

/**
 * Whether this viewer may change this task.
 *
 * A collaborator granted `view` changes nothing, and no collaborator touches a
 * private task — they cannot see one, and an id typed into a form must not be
 * a way around that.
 */
export function canEditTask(
  task: { isPrivate: boolean },
  viewer: Pick<Viewer, 'role' | 'level'>,
): boolean {
  if (!canSeeTask(task, viewer)) return false;
  if (isAccountHolder(viewer)) return true;
  return viewer.level === 'edit';
}

/**
 * Only he decides what is private and who gets in.
 *
 * Not the operator: the star is the one thing on this screen that is about him
 * rather than about the work, and the grant list is the key to the board.
 */
export const canManageAccess = (viewer: Pick<Viewer, 'role'>): boolean => viewer.role === 'owner';

/** The screens a viewer may reach at all. */
export function mayReach(pathname: string, viewer: Pick<Viewer, 'role'>): boolean {
  if (isAccountHolder(viewer)) return true;

  /*
   * A collaborator gets the tasks board and the things a page needs to render
   * — and nothing else. Checked as a path segment rather than a prefix, so
   * `/tasks-secret` or `/tasksomething` is not mistaken for `/tasks`.
   */
  return pathname === '/tasks' || pathname.startsWith('/tasks/');
}

export interface Grant {
  id: string;
  email: string;
  personName: string | null;
  level: AccessLevel;
  grantedBy: string;
  grantedAt: Date;
}

/**
 * An address is one address.
 *
 * Two grants to the same person spelled differently would leave the gate
 * picking whichever row came back first, so everything compares on this.
 */
export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/**
 * What role an address gets, given the accounts and the live grants.
 *
 * The account roles win. Somebody who is already the owner does not become a
 * collaborator because a grant row exists for them — that would take away the
 * rest of their own cockpit.
 */
export function roleFor(
  email: string,
  accountRole: 'owner' | 'operator' | null,
  grant: { level: AccessLevel } | null,
): Viewer | null {
  const clean = normaliseEmail(email);
  if (accountRole) return { email: clean, role: accountRole };
  if (grant) return { email: clean, role: 'collaborator', level: grant.level };
  return null;
}
