import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, users } from '@/lib/db';
import { isAccountRole, reconcileAccountRow } from '@/lib/auth/reconcile';

/**
 * Signing in as somebody who was granted the tasks board.
 *
 * Assaf could not get in for a day. The password was right every time — his
 * last_login_at was rewritten on every attempt — and the sign-in still failed,
 * because the callback wrote a `users` row for him with role 'collaborator'
 * and the table accepts only 'owner' or 'operator'. The constraint did its
 * job; the exception came out of the jwt callback; Auth.js turned the whole
 * sign-in into error=Configuration, and he was bounced to /login as though he
 * had typed the wrong password.
 *
 * These run against the real table, so the CHECK constraint is the thing under
 * test rather than a copy of it.
 */
const PROBE = `zz-probe-${Date.now()}@adnimation.com`;

afterEach(async () => {
  await db.delete(users).where(eq(users.email, PROBE));
});

describe('the account row behind a sign-in', () => {
  it('writes nothing at all for a collaborator', async () => {
    const id = await reconcileAccountRow(PROBE, 'Probe', 'collaborator');

    expect(id).toBeUndefined();
    expect(await db.select().from(users).where(eq(users.email, PROBE))).toHaveLength(0);
  });

  it('creates one for an account holder, and reuses it next time', async () => {
    const first = await reconcileAccountRow(PROBE, 'Probe', 'operator');
    expect(first).toBeTruthy();

    const second = await reconcileAccountRow(PROBE, 'Probe', 'operator');
    expect(second).toBe(first);
    expect(await db.select().from(users).where(eq(users.email, PROBE))).toHaveLength(1);
  });

  /*
   * The reason the rule exists, asserted rather than described: the table
   * really does refuse a collaborator, so anything that tries to write one is
   * a failed sign-in and not a tidy-up job for later.
   */
  it('proves the table refuses a collaborator, which is why we never offer one', async () => {
    await expect(
      db.insert(users).values({ email: PROBE, name: 'Probe', role: 'collaborator' }),
    ).rejects.toThrow();
  });

  it('knows which roles are accounts', () => {
    expect(isAccountRole('owner')).toBe(true);
    expect(isAccountRole('operator')).toBe(true);
    expect(isAccountRole('collaborator')).toBe(false);
  });
});
