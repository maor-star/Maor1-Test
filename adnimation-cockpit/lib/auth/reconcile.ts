import { eq } from 'drizzle-orm';
import { db, users } from '@/lib/db';

/**
 * The `users` row behind a sign-in — and who does not get one.
 *
 * `users` is the two real accounts, and the table says so in a CHECK
 * constraint: `role = ANY ('owner', 'operator')`. That is not an oversight,
 * it is the spec — the cockpit has two accounts, and somebody granted the
 * tasks board is a guest on one screen rather than a third account.
 *
 * The sign-in callback used to write a row for EVERYONE, with whatever role
 * the token carried. For a collaborator that is the string 'collaborator', the
 * constraint refused it, the exception came back out of the jwt callback, and
 * Auth.js turned the whole sign-in into `error=Configuration` — no session, a
 * bounce to /login, and a person who had just typed the right password being
 * told, in effect, that it was wrong. Assaf hit this every time for a day.
 *
 * So the rule is explicit here rather than implied by a callback: only an
 * account holder gets an account row. A collaborator is carried by
 * `task_access` and `collaborator_logins`, which is where they already live,
 * and nothing on the tasks board reads a user id — every mutation records the
 * actor by address.
 */
export type SignInRole = 'owner' | 'operator' | 'collaborator';

/** Whether this role is one of the two accounts the `users` table holds. */
export const isAccountRole = (role: SignInRole): role is 'owner' | 'operator' =>
  role === 'owner' || role === 'operator';

/**
 * Returns the account's id, or undefined for somebody who has no account row
 * and is not supposed to get one.
 */
export async function reconcileAccountRow(
  email: string,
  name: string,
  role: SignInRole,
): Promise<string | undefined> {
  if (!isAccountRole(role)) return undefined;

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) return existing[0]?.id;

  const [created] = await db.insert(users).values({ email, name, role }).returning({ id: users.id });
  return created?.id;
}
